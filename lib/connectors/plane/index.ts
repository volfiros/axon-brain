import { createHmac, timingSafeEqual } from "node:crypto";

import type { AxonGraph } from "@/lib/graph/client";

import type { Batch, Connector, ConnectorContext } from "../types";
import { projectId, sourceId } from "../write";
import { httpPlaneApi, type PlaneApi } from "./api";
import {
  commentBatch,
  isSecret,
  memberToPerson,
  planeRef,
  projectBatch,
  scopeOf,
  workItemBatch,
  type PlaneComment,
  type PlaneLinks,
  type PlaneMember,
  type PlaneProject,
  type PlaneWorkItem,
  type ProjectScope,
} from "./normalize";

export type PlaneEvent = {
  event?: string;
  data?: Record<string, unknown>;
  previous_attributes?: Record<string, unknown>;
};

export function planeConfig() {
  return {
    apiUrl: process.env.PLANE_API_URL || "https://api.plane.so",
    appUrl: process.env.PLANE_APP_URL || "https://app.plane.so",
    apiKey: process.env.PLANE_API_KEY || "",
    workspaceSlug: process.env.PLANE_WORKSPACE_SLUG || "",
    webhookSecret: process.env.PLANE_WEBHOOK_SECRET || "",
  };
}

function planeLinks(): PlaneLinks {
  const { appUrl, workspaceSlug } = planeConfig();
  return { appUrl, workspaceSlug };
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
}

function isNewerThan(timestamp: string | undefined, since: string | undefined): boolean {
  return !since || !timestamp || Date.parse(timestamp) > Date.parse(since);
}

export async function* backfillWith(api: PlaneApi, ctx: ConnectorContext, links = planeLinks()): AsyncIterable<Batch> {
  yield { people: (await collect(api.list<PlaneMember>("/members/"))).map(memberToPerson) };

  for await (const project of api.list<PlaneProject>("/projects/")) {
    if (project.archived_at) continue;
    yield projectBatch(project, links);
    const visibleTo = isSecret(project)
      ? (await collect(api.list<PlaneMember>(`/projects/${project.id}/members/`))).map((m) => planeRef(m.member ?? m.id))
      : undefined;
    const scope = scopeOf(project, visibleTo);

    // Work items come newest first, so a poll stops at the first one it has already synced.
    for await (const item of api.list<PlaneWorkItem>(`/projects/${project.id}/work-items/`, { order_by: "-updated_at" })) {
      if (!isNewerThan(item.updated_at, ctx.since)) break;
      yield workItemBatch(scope, item, links);
      for await (const comment of api.list<PlaneComment>(`/projects/${project.id}/work-items/${item.id}/comments/`)) {
        yield commentBatch(scope, comment, item.name, links);
      }
    }
  }
}

// A project Axon has not synced yet stays Admin-only until the next poll reads its members.
async function projectScope(graph: AxonGraph, id: string): Promise<ProjectScope> {
  const [row] = await graph.roQuery<{ sensitivity: string; key: string | null; ids: string[][] }>(
    `MATCH (p:Project {id: $id})
     OPTIONAL MATCH (s:Source)-[:PART_OF]->(p)
     OPTIONAL MATCH (s)-[:VISIBLE_TO]->(x:Person)
     RETURN p.sensitivity AS sensitivity, p.key AS key, collect(DISTINCT x.external_ids) AS ids`,
    { id: projectId("plane", id) },
  );
  const key = row?.key ?? undefined;
  if (row?.sensitivity === "team") return { id, sensitivity: "team", key };
  const members = (row?.ids ?? [])
    .flat()
    .filter((key) => key.startsWith("plane:"))
    .map((key) => planeRef(key.slice("plane:".length)));
  return { id, sensitivity: "restricted", visible_to: members, key };
}

async function workItemName(graph: AxonGraph, itemId: string): Promise<string> {
  const [row] = await graph.roQuery<{ title: string }>("MATCH (s:Source {id: $id}) RETURN s.title AS title", {
    id: sourceId("plane", itemId),
  });
  return row?.title ?? "a work item";
}

export async function* planeEventBatches(event: PlaneEvent, ctx: ConnectorContext, links = planeLinks()): AsyncIterable<Batch> {
  const name = event.event ?? "";
  const deleted = name.endsWith(".deleted");
  const record = (deleted ? event.previous_attributes : event.data) ?? {};
  const deletedAt = deleted ? new Date().toISOString() : undefined;

  if (name.startsWith("project.")) {
    const project = record as PlaneProject;
    if (project.id && !deleted) yield projectBatch(project, links);
    return;
  }

  if (name.startsWith("workitem.comment.")) {
    const nested = record.comment as PlaneComment | undefined;
    const comment = nested ?? (record as PlaneComment);
    const itemId = comment.issue ?? (nested ? (record.id as string | undefined) : undefined);
    const project = (comment as { project?: string }).project ?? (record.project as string | undefined);
    if (!comment.id || !itemId || !project) return;
    const itemName = nested && typeof record.name === "string" ? record.name : await workItemName(ctx.graph, itemId);
    yield commentBatch(await projectScope(ctx.graph, project), { ...comment, issue: itemId }, itemName, links, deletedAt);
    return;
  }

  if (/^workitem\.[a-z]+$/.test(name)) {
    const item = record as PlaneWorkItem;
    if (item.id && item.project) yield workItemBatch(await projectScope(ctx.graph, item.project), item, links, deletedAt);
  }
}

export function verifyPlaneSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const planeConnector: Connector<PlaneEvent> = {
  name: "plane",
  backfill(ctx) {
    const config = planeConfig();
    const api = httpPlaneApi({ apiUrl: config.apiUrl, apiKey: ctx.token ?? config.apiKey, workspaceSlug: config.workspaceSlug });
    return backfillWith(api, ctx);
  },
  verifyWebhook(req, rawBody) {
    return verifyPlaneSignature(rawBody, req.headers.get("X-Plane-Signature"), planeConfig().webhookSecret);
  },
  eventToBatches(_headers, payload, ctx) {
    return planeEventBatches(payload, ctx);
  },
};
