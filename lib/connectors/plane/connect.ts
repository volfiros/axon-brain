import { appUrl } from "@/lib/auth";

import { assertAdmin, getConnector, loadSecrets, saveConnector, setConnectorStatus } from "../credentials";

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

function normalizeApiUrl(raw: string | undefined): string {
  if (!raw?.trim()) return PLANE_CLOUD_API;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("The Plane API URL is not a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("The Plane API URL must use https");
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
  const apiUrl = normalizeApiUrl(input.apiUrl);
  const headers = { "X-API-Key": apiKey, Accept: "application/json", "Content-Type": "application/json" };

  const check = await fetchImpl(`${apiUrl}/api/v1/workspaces/${workspaceSlug}/members/`, { headers });
  if (check.status === 401 || check.status === 403) throw new Error("Plane rejected this API key for that workspace");
  if (check.status === 404) throw new Error(`Plane has no workspace "${workspaceSlug}"`);
  if (!check.ok) throw new Error(`Plane answered ${check.status} when checking the key`);

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
  await setConnectorStatus(slug, "plane", "syncing");
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
      body: JSON.stringify({ name: "Axon", url, scopes: PLANE_WEBHOOK_SCOPES, is_active: true }),
    });
    if (created.ok) return (await created.json()) as Webhook;
    // Plane keeps one webhook per URL; reconnecting finds it and regenerates its secret, which is only shown on create.
    if (created.status !== 400) return null;
    const list = await fetchImpl(base, { headers });
    if (!list.ok) return null;
    const body = (await list.json()) as Webhook[] | { results: Webhook[] };
    const existing = (Array.isArray(body) ? body : body.results).find((hook) => hook.url === url);
    if (!existing) return null;
    const regenerated = await fetchImpl(`${base}${existing.id}/regenerate/`, { method: "POST", headers });
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
  }).catch(() => undefined);
}
