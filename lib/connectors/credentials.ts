import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { accountsGraph, workspaceGraph, type Params } from "@/lib/graph/client";
import { getMember } from "@/lib/workspaces";

import type { ConnectorStatus } from "./github/connection";

export type Provider = "slack" | "plane";

export type StoredConnector = {
  provider: Provider;
  status: ConnectorStatus;
  label: string | null;
  error: string | null;
  synced_at: string | null;
  sync_started_at: string | null;
  team_id: string | null;
  workspace_slug: string | null;
  api_url: string | null;
  app_url: string | null;
  webhook_id: string | null;
  has_webhook_secret: boolean;
};

export type Secrets = Partial<Record<"token" | "webhook_secret", string>>;

const SECRET_FIELDS = ["token", "webhook_secret"] as const;
const PUBLIC_FIELDS = [
  "label",
  "error",
  "team_id",
  "workspace_slug",
  "api_url",
  "app_url",
  "webhook_id",
] as const;

function encryptionKey(): Buffer {
  const raw = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!raw) throw new Error("CONNECTOR_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CONNECTOR_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return key;
}

export function encryptionConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

/** AES-256-GCM. `context` is bound as associated data, so a value copied to another connector or field fails to decrypt. */
export function encryptSecret(plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), body].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

export function decryptSecret(stored: string, context: string): string {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) throw new Error("Unreadable connector secret");
  const authTag = Buffer.from(tag, "base64url");
  if (authTag.length !== 16) throw new Error("Unreadable connector secret");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

function connectorId(slug: string, provider: Provider): string {
  return `${provider}:${slug}`;
}

function nowUtc(): string {
  return new Date().toISOString().slice(0, 19);
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

export async function assertAdmin(slug: string, accountId: string): Promise<void> {
  const member = await getMember(slug, accountId).catch(() => null);
  if (member?.role !== "Admin") throw new Error("Only a Workspace Admin can manage connectors");
}

/** Creates or replaces the Workspace's connector. Secrets are encrypted here and never leave this module in plain text except through `loadSecrets`. */
export async function saveConnector(
  slug: string,
  provider: Provider,
  fields: Partial<Record<(typeof PUBLIC_FIELDS)[number], string | null>>,
  secrets: Secrets,
): Promise<void> {
  const id = connectorId(slug, provider);
  const encrypted: Record<string, string | null> = {};
  for (const field of SECRET_FIELDS) {
    const value = secrets[field];
    if (value !== undefined) encrypted[`enc_${field}`] = value ? encryptSecret(value, `${id}:${field}`) : null;
  }
  await accountsGraph().query(
    `MATCH (w:Workspace {slug: $slug})
     MERGE (c:Connector {id: $id})-[:FOR]->(w)
     SET c.provider = $provider, c += $fields, c += $encrypted`,
    { slug, id, provider, fields, encrypted },
  );
}

export async function getConnector(slug: string, provider: Provider): Promise<StoredConnector | null> {
  const [row] = await readAccounts<StoredConnector>(
    `MATCH (c:Connector {id: $id})-[:FOR]->(:Workspace {slug: $slug})
     RETURN c.provider AS provider, coalesce(c.status, 'disconnected') AS status, c.label AS label, c.error AS error,
            toString(c.synced_at) AS synced_at, toString(c.sync_started_at) AS sync_started_at,
            c.team_id AS team_id, c.workspace_slug AS workspace_slug, c.api_url AS api_url, c.app_url AS app_url,
            c.webhook_id AS webhook_id, c.enc_webhook_secret IS NOT NULL AS has_webhook_secret`,
    { id: connectorId(slug, provider), slug },
  );
  return row ?? null;
}

export async function loadSecrets(slug: string, provider: Provider): Promise<Secrets> {
  const id = connectorId(slug, provider);
  const [row] = await readAccounts<{ token: string | null; webhook_secret: string | null }>(
    `MATCH (c:Connector {id: $id})-[:FOR]->(:Workspace {slug: $slug})
     RETURN c.enc_token AS token, c.enc_webhook_secret AS webhook_secret`,
    { id, slug },
  );
  const secrets: Secrets = {};
  for (const field of SECRET_FIELDS) {
    const value = row?.[field];
    if (value) secrets[field] = decryptSecret(value, `${id}:${field}`);
  }
  return secrets;
}

export async function deleteConnector(slug: string, provider: Provider): Promise<void> {
  await accountsGraph().query(
    `MATCH (c:Connector {id: $id})-[:FOR]->(:Workspace {slug: $slug})
     DETACH DELETE c`,
    { id: connectorId(slug, provider), slug },
  );
}

/**
 * Stores a Slack install in one query, so two Workspaces can never both claim a team.
 * Returns false when the team is already connected to another Workspace.
 */
export async function claimSlackTeam(slug: string, teamId: string, label: string, token: string): Promise<boolean> {
  const id = connectorId(slug, "slack");
  const rows = await accountsGraph().query<{ id: string }>(
    `MATCH (w:Workspace {slug: $slug})
     OPTIONAL MATCH (other:Connector {provider: 'slack', team_id: $teamId})
     WHERE other.id <> $id
     WITH w, count(other) AS taken
     WHERE taken = 0
     MERGE (c:Connector {id: $id})-[:FOR]->(w)
     SET c.provider = 'slack', c.team_id = $teamId, c.label = $label, c.enc_token = $token
     RETURN c.id AS id`,
    { slug, id, teamId, label, token: encryptSecret(token, `${id}:token`) },
  );
  return rows.length > 0;
}

export async function workspaceForSlackTeam(teamId: string): Promise<string | null> {
  const rows = await readAccounts<{ slug: string }>(
    `MATCH (c:Connector {provider: 'slack', team_id: $teamId})-[:FOR]->(w:Workspace)
     WHERE c.enc_token IS NOT NULL
     RETURN w.slug AS slug LIMIT 1`,
    { teamId },
  );
  return rows[0]?.slug ?? null;
}

/** Status lives on the connector node, which also exists for a Workspace configured by server env vars. */
export async function setConnectorStatus(slug: string, provider: Provider, status: ConnectorStatus, error?: string): Promise<void> {
  await accountsGraph().query(
    `MATCH (w:Workspace {slug: $slug})
     MERGE (c:Connector {id: $id})-[:FOR]->(w)
     SET c.provider = $provider, c.status = $status,
         c.error = CASE WHEN $status = 'error' THEN $error ELSE null END,
         c.sync_started_at = CASE WHEN $status = 'syncing' THEN localdatetime($now) ELSE c.sync_started_at END,
         c.synced_at = CASE WHEN $status = 'synced' THEN localdatetime($now) ELSE c.synced_at END`,
    { slug, id: connectorId(slug, provider), provider, status, error: error ?? null, now: nowUtc() },
  );
}

export async function sourceCounts(slug: string): Promise<Record<string, number>> {
  const rows = await workspaceGraph(slug)
    .roQuery<{ connector: string; n: number }>(
      `MATCH (s:Source) WHERE s.connector IS NOT NULL AND s.deleted_at IS NULL
       RETURN s.connector AS connector, count(s) AS n`,
    )
    .catch(() => []);
  return Object.fromEntries(rows.map((row) => [row.connector, row.n]));
}

export function isProvider(value: string): value is Provider {
  return value === "slack" || value === "plane";
}
