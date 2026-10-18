import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { appUrl } from "@/lib/auth";

import { assertAdmin, getConnector, loadSecrets, saveConnector } from "../credentials";

export const PLANE_CLOUD_API = "https://api.plane.so";
const PLANE_CLOUD_APP = "https://app.plane.so";
const PLANE_SLUG = /^[a-z0-9][a-z0-9_-]*$/i;

export const PLANE_WEBHOOK_SCOPES = [
  "project.created",
  "project.updated",
  "project.deleted",
  "workitem.created",
  "workitem.updated",
  "workitem.archived",
  "workitem.deleted",
  "workitem.comment.created",
  "workitem.comment.updated",
  "workitem.comment.deleted",
];

export type PlaneInput = { apiKey: string; workspaceSlug: string; apiUrl?: string };
export type PlaneConnectResult = { webhook: "registered" | "manual" };

type Webhook = { id: string; url: string; secret_key?: string };

export function planeWebhookUrl(slug: string): string {
  return `${appUrl}/api/w/${slug}/plane/webhook`;
}

const URL_ERROR = "The Plane API URL must be a public https address";

// The API URL is chosen by the Admin and fetched from the server, so internal and metadata addresses are refused.
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return BLOCKED.check(mapped, "ipv4");
  return BLOCKED.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

/** Throws unless every address the host resolves to is public. */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  } catch {
    throw new Error(URL_ERROR);
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) throw new Error(URL_ERROR);
}

export async function normalizeApiUrl(raw: string | undefined): Promise<string> {
  if (!raw?.trim()) return PLANE_CLOUD_API;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(URL_ERROR);
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(URL_ERROR);
  await assertPublicHost(url.hostname);
  return url.origin;
}

/**
 * Checks the key against Plane, stores it encrypted, then registers Axon's webhook through Plane's v2 API.
 * When Plane refuses the webhook (a plan without webhooks, or a URL Plane cannot reach) the Admin pastes the secret instead.
 */
export async function connectPlane(
  slug: string,
  accountId: string,
  input: PlaneInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PlaneConnectResult> {
  await assertAdmin(slug, accountId);
  const apiKey = input.apiKey.trim();
  const workspaceSlug = input.workspaceSlug.trim();
  if (!apiKey) throw new Error("Enter a Plane API key");
  if (!PLANE_SLUG.test(workspaceSlug)) throw new Error("Enter the Plane workspace slug from its URL");
  const apiUrl = await normalizeApiUrl(input.apiUrl);
  const headers = { "X-API-Key": apiKey, Accept: "application/json", "Content-Type": "application/json" };

  // Redirects are never followed, so the API key only ever goes to the checked host.
  const check = await fetchImpl(`${apiUrl}/api/v1/workspaces/${workspaceSlug}/members/`, { headers, redirect: "manual" });
  if (check.status === 401 || check.status === 403) throw new Error("Plane rejected this API key for that workspace");
  if (check.status === 404) throw new Error(`Plane has no workspace "${workspaceSlug}"`);
  if (!check.ok) throw new Error(`Plane answered ${check.status} when checking the key`);

  const previous = await getConnector(slug, "plane");
  if (previous && (previous.api_url !== apiUrl || previous.workspace_slug !== workspaceSlug)) {
    await removePlaneWebhook(slug, fetchImpl).catch(() => undefined);
  }

  const webhook = await registerWebhook(fetchImpl, `${apiUrl}/api/v2/workspaces/${workspaceSlug}/webhooks/`, headers, planeWebhookUrl(slug));
  await saveConnector(
    slug,
    "plane",
    {
      label: workspaceSlug,
      workspace_slug: workspaceSlug,
      api_url: apiUrl,
      app_url: apiUrl === PLANE_CLOUD_API ? PLANE_CLOUD_APP : apiUrl,
      webhook_id: webhook?.id ?? null,
    },
    { token: apiKey, webhook_secret: webhook?.secret_key ?? "" },
  );
  return { webhook: webhook?.secret_key ? "registered" : "manual" };
}

async function registerWebhook(
  fetchImpl: typeof fetch,
  base: string,
  headers: Record<string, string>,
  url: string,
): Promise<Webhook | null> {
  try {
    const created = await fetchImpl(base, {
      method: "POST",
      headers,
      redirect: "manual",
      body: JSON.stringify({ name: "Axon", url, scopes: PLANE_WEBHOOK_SCOPES, is_active: true }),
    });
    if (created.ok) return (await created.json()) as Webhook;
    // Plane keeps one webhook per URL; reconnecting finds it and regenerates its secret, which is only shown on create.
    if (created.status !== 400) return null;
    const list = await fetchImpl(base, { headers, redirect: "manual" });
    if (!list.ok) return null;
    const body = (await list.json()) as Webhook[] | { results: Webhook[] };
    const existing = (Array.isArray(body) ? body : body.results).find((hook) => hook.url === url);
    if (!existing) return null;
    const regenerated = await fetchImpl(`${base}${existing.id}/regenerate/`, { method: "POST", headers, redirect: "manual" });
    return regenerated.ok ? { ...existing, ...((await regenerated.json()) as Partial<Webhook>) } : null;
  } catch {
    return null;
  }
}

export async function savePlaneWebhookSecret(slug: string, accountId: string, secret: string): Promise<void> {
  await assertAdmin(slug, accountId);
  if (!(await getConnector(slug, "plane"))) throw new Error("Connect Plane first");
  if (!secret.trim()) throw new Error("Paste the webhook secret from Plane");
  await saveConnector(slug, "plane", {}, { webhook_secret: secret.trim() });
}

/** Removes Axon's webhook from Plane when Axon registered it. Failure is ignored so Disconnect always works. */
export async function removePlaneWebhook(slug: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const stored = await getConnector(slug, "plane");
  if (!stored?.webhook_id || !stored.api_url || !stored.workspace_slug) return;
  const { token } = await loadSecrets(slug, "plane");
  if (!token) return;
  await fetchImpl(`${stored.api_url}/api/v2/workspaces/${stored.workspace_slug}/webhooks/${stored.webhook_id}/`, {
    method: "DELETE",
    headers: { "X-API-Key": token },
    redirect: "manual",
  }).catch(() => undefined);
}
