import { workspaceGraph } from "@/lib/graph/client";
import { ensureWorkspaceSchema } from "@/lib/graph/schema";

import { getConnector, loadSecrets, setConnectorStatus, type Provider } from "./credentials";
import { planeConfig, backfillWith as planeBackfill } from "./plane";
import { httpPlaneApi } from "./plane/api";
import type { PlaneLinks } from "./plane/normalize";
import { slackConfig, backfillWith as slackBackfill } from "./slack";
import { httpSlackApi } from "./slack/api";
import type { Batch, ConnectorContext } from "./types";
import { writeBatch } from "./write";

export type PlaneCredentials = { apiUrl: string; apiKey: string; webhookSecret: string; links: PlaneLinks; fromEnv: boolean };
export type SlackCredentials = { token: string; fromEnv: boolean };

// A run longer than Vercel's 300 second limit is killed without a chance to record it, so an old "syncing" means it stopped.
const STALE_SYNC_MS = 6 * 60 * 1000;

function isEnvWorkspace(slug: string): boolean {
  return slug === process.env.CONNECTORS_WORKSPACE;
}

/** Stored credentials win; the env vars still serve the one Workspace named in CONNECTORS_WORKSPACE. */
export async function resolvePlane(slug: string): Promise<PlaneCredentials | null> {
  const stored = await getConnector(slug, "plane");
  if (stored?.workspace_slug && stored.api_url) {
    const secrets = await loadSecrets(slug, "plane");
    if (secrets.token) {
      return {
        apiUrl: stored.api_url,
        apiKey: secrets.token,
        webhookSecret: secrets.webhook_secret ?? "",
        links: { appUrl: stored.app_url ?? stored.api_url, workspaceSlug: stored.workspace_slug },
        fromEnv: false,
      };
    }
  }
  const env = planeConfig();
  if (!isEnvWorkspace(slug) || !env.apiKey || !env.workspaceSlug) return null;
  return {
    apiUrl: env.apiUrl,
    apiKey: env.apiKey,
    webhookSecret: env.webhookSecret,
    links: { appUrl: env.appUrl, workspaceSlug: env.workspaceSlug },
    fromEnv: true,
  };
}

export async function resolveSlack(slug: string): Promise<SlackCredentials | null> {
  const { token } = await loadSecrets(slug, "slack");
  if (token) return { token, fromEnv: false };
  const env = slackConfig().botToken;
  return isEnvWorkspace(slug) && env ? { token: env, fromEnv: true } : null;
}

export function isStale(syncStartedAt: string | null): boolean {
  return !syncStartedAt || Date.now() - Date.parse(`${syncStartedAt}Z`) > STALE_SYNC_MS;
}

// Only a sync that finished can be continued from; after a failure or timeout the full import runs again (writes are idempotent).
async function resumePoint(slug: string, provider: Provider): Promise<string | undefined> {
  const connector = await getConnector(slug, provider);
  if (connector?.status !== "synced" || !connector.synced_at) return undefined;
  if (provider === "slack") return `${connector.synced_at}Z`;
  const [latest] = await workspaceGraph(slug).roQuery<{ since: unknown }>(
    "MATCH (s:Source {connector: 'plane'}) RETURN max(s.updated_at) AS since",
  );
  return latest?.since ? `${String(latest.since)}Z` : undefined;
}

function batchesFor(provider: Provider, ctx: ConnectorContext, plane: PlaneCredentials | null, slack: SlackCredentials | null) {
  if (provider === "plane" && plane) {
    const api = httpPlaneApi({ apiUrl: plane.apiUrl, apiKey: plane.apiKey, workspaceSlug: plane.links.workspaceSlug });
    return planeBackfill(api, ctx, plane.links);
  }
  if (provider === "slack" && slack) return slackBackfill(httpSlackApi(slack.token), { ...ctx, token: slack.token });
  return null;
}

/** Imports everything new from Slack or Plane into the Workspace graph and records the outcome on the connector. */
export async function syncConnector(slug: string, provider: Provider): Promise<number> {
  const plane = provider === "plane" ? await resolvePlane(slug) : null;
  const slack = provider === "slack" ? await resolveSlack(slug) : null;
  const graph = workspaceGraph(slug);
  const since = await resumePoint(slug, provider);
  const batches: AsyncIterable<Batch> | null = batchesFor(provider, { workspace: slug, graph, since }, plane, slack);
  if (!batches) throw new Error(`${provider} is not connected`);

  await ensureWorkspaceSchema(graph);
  await setConnectorStatus(slug, provider, "syncing");
  let sources = 0;
  try {
    for await (const batch of batches) {
      await writeBatch(graph, batch);
      sources += batch.sources?.length ?? 0;
    }
    await setConnectorStatus(slug, provider, "synced");
    return sources;
  } catch (err) {
    await setConnectorStatus(slug, provider, "error", (err as Error).message.slice(0, 200));
    throw err;
  }
}
