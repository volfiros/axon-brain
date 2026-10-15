import { createHmac, timingSafeEqual } from "node:crypto";

import { accountsGraph, workspaceGraph, type Params } from "@/lib/graph/client";
import { ensureWorkspaceSchema } from "@/lib/graph/schema";
import { writeBatch } from "@/lib/connectors/write";
import { getWorkspace } from "@/lib/workspaces";

import { ghAll, getInstallation, installationToken } from "./api";
import { github } from "./index";
import type { GhRepo } from "./normalize";

export type ConnectorStatus = "syncing" | "synced" | "error" | "disconnected";

export type GithubConnection = {
  installation_id: number;
  repo: string;
  status: ConnectorStatus;
  synced_at: string | null;
};

const STATE_TTL_SECONDS = 60 * 60;

function stateSignature(payload: string): string {
  const secret = process.env.CONNECTOR_STATE_SECRET;
  if (!secret) throw new Error("CONNECTOR_STATE_SECRET is not set");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** The install link carries this through GitHub so the callback knows which Workspace started it. */
export function signState(slug: string): string {
  const payload = `${slug}.${Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS}`;
  return `${payload}.${stateSignature(payload)}`;
}

export function verifyState(state: string): string | null {
  const [slug, expires, signature] = state.split(".");
  if (!slug || !expires || !signature) return null;
  const expected = Buffer.from(stateSignature(`${slug}.${expires}`));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return Number(expires) > Date.now() / 1000 ? slug : null;
}

export function githubAppConfigured(): boolean {
  return Boolean(process.env.GITHUB_APP_SLUG && process.env.CONNECTOR_STATE_SECRET);
}

export function installUrl(slug: string): string {
  const app = process.env.GITHUB_APP_SLUG;
  if (!app) throw new Error("GITHUB_APP_SLUG is not set");
  return `https://github.com/apps/${app}/installations/new?state=${encodeURIComponent(signState(slug))}`;
}

function connectorId(installationId: number): string {
  return `github:${installationId}`;
}

async function readAccounts<T>(cypher: string, params: Params): Promise<T[]> {
  try {
    return await accountsGraph().roQuery<T>(cypher, params);
  } catch (err) {
    // FalkorDB rejects read-only queries on a graph that has never been written ("empty key").
    if (/empty key/i.test((err as Error).message)) return [];
    throw err;
  }
}

/** Verifies the installation belongs to this App, then links it to the Workspace in the accounts graph. */
export async function connectInstallation(slug: string, installationId: number): Promise<string[]> {
  if (!(await getWorkspace(slug))) throw new Error(`No workspace ${slug}`);
  await getInstallation(installationId);
  const token = await installationToken(installationId);
  const repos = (await ghAll<GhRepo>(token, "/installation/repositories")).map((r) => r.full_name);
  await accountsGraph().query(
    `MATCH (w:Workspace {slug: $slug})
     MERGE (c:Connector {id: $id})
     SET c.provider = 'github', c.installation_id = $installationId, c.repo = $repo, c.status = 'syncing'
     WITH c, w
     OPTIONAL MATCH (c)-[old:FOR]->(:Workspace)
     DELETE old
     WITH DISTINCT c, w
     MERGE (c)-[:FOR]->(w)`,
    { slug, id: connectorId(installationId), installationId, repo: repos.join(", ") },
  );
  return repos;
}

export async function workspaceForInstallation(installationId: number): Promise<string | null> {
  const rows = await readAccounts<{ slug: string }>(
    `MATCH (c:Connector {id: $id})-[:FOR]->(w:Workspace)
     WHERE c.status <> 'disconnected'
     RETURN w.slug AS slug`,
    { id: connectorId(installationId) },
  );
  return rows[0]?.slug ?? null;
}

export async function githubConnection(slug: string): Promise<GithubConnection | null> {
  const rows = await readAccounts<GithubConnection>(
    `MATCH (c:Connector {provider: 'github'})-[:FOR]->(:Workspace {slug: $slug})
     RETURN c.installation_id AS installation_id, c.repo AS repo, c.status AS status, toString(c.synced_at) AS synced_at
     LIMIT 1`,
    { slug },
  );
  return rows[0] ?? null;
}

export async function setStatus(installationId: number, status: ConnectorStatus): Promise<void> {
  await accountsGraph().query(
    `MATCH (c:Connector {id: $id})
     SET c.status = $status,
         c.synced_at = CASE WHEN $status = 'synced' THEN localdatetime($now) ELSE c.synced_at END`,
    { id: connectorId(installationId), status, now: new Date().toISOString().slice(0, 19) },
  );
}

/** Full or incremental (`since`, ISO 8601) backfill of every repository the installation can read. */
export async function syncInstallation(slug: string, installationId: number, since?: string): Promise<number> {
  const graph = workspaceGraph(slug);
  await ensureWorkspaceSchema(graph);
  await setStatus(installationId, "syncing");
  try {
    const token = await installationToken(installationId);
    let batches = 0;
    for await (const batch of github.backfill({ workspace: slug, graph, token, since })) {
      await writeBatch(graph, batch);
      batches++;
    }
    await setStatus(installationId, "synced");
    return batches;
  } catch (err) {
    await setStatus(installationId, "error");
    throw err;
  }
}
