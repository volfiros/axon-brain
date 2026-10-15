import { FROM_CALLER, visible } from "./access";
import type { BrainContext } from "./tool";

export type SourceChange = { title: string; change: "edited" | "deleted"; at: unknown };

/**
 * Cypher predicate on a `(d)-[r:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)` match: the Source changed since the link was stamped.
 * A Source without a content_hash (a saved conversation, seed data) can only be flagged as deleted.
 */
export function sourceChanged(r: string, s: string): string {
  return `((${s}.deleted_at IS NOT NULL AND (${r}.checked_at IS NULL OR ${r}.checked_at < ${s}.deleted_at))
          OR (${s}.deleted_at IS NULL AND ${r}.source_hash IS NOT NULL AND ${s}.content_hash <> ${r}.source_hash))`;
}

export function sourceChangeRow(r: string, s: string): string {
  return `{title: ${s}.title, change: CASE WHEN ${s}.deleted_at IS NULL THEN 'edited' ELSE 'deleted' END,
           at: coalesce(${s}.deleted_at, ${s}.updated_at, ${s}.synced_at)}`;
}

/** Stamps the current content_hash on links that have none yet, keeping any hash recorded when the decision was proposed. */
export async function stampMissingHashes(ctx: BrainContext, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await ctx.graph.query(
    `MATCH (d:Decision)-[r:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)
     WHERE d.id IN $ids AND r.source_hash IS NULL AND s.content_hash IS NOT NULL
     SET r.source_hash = s.content_hash`,
    { ids },
  );
}

/**
 * Records that a person checked the changed Sources behind accepted decisions and the decisions still hold.
 * Only links to Sources the caller can see are re-stamped. Decision status is never changed here.
 */
export async function confirmStillHolds(ctx: BrainContext, ids: string[]): Promise<{ id: string; title: string }[]> {
  return ctx.graph.query<{ id: string; title: string }>(
    `${FROM_CALLER}
     MATCH (d:Decision)-[r:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)
     WHERE d.id IN $ids AND d.status = 'accepted' AND ${visible("d")} AND ${visible("s")} AND ${sourceChanged("r", "s")}
     SET r.source_hash = s.content_hash, r.checked_at = localdatetime(), r.checked_by = $personId
     RETURN DISTINCT d.id AS id, d.title AS title`,
    { ids, personId: ctx.caller.personId },
  );
}
