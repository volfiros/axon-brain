import { FROM_CALLER, readAsCaller, visible } from "./access";
import { day } from "./search";
import type { BrainContext } from "./tool";

/** PRs or commits touching a decision's code after it was made before it counts as stale. */
export const STALE_AFTER = 3;

export type CodeChange = { id: string; title: string; url: string | null; date: string; paths: string[] };

export type StaleDecision = { id: string; title: string; made: string; changes: CodeChange[]; owners: string[] };

type Row = {
  id: string;
  title: string;
  made: unknown;
  source: string;
  sourceTitle: string;
  url: string | null;
  at: unknown;
  path: string;
  owners: string[];
};

// A decision's own source and implementing PRs are not later change.
const CHANGES = `
  ${FROM_CALLER}
  MATCH (d:Decision {status: 'accepted'})-[:AFFECTS]->(c:CodeUnit)<-[:TOUCHES]-(s:Source)
  WHERE ($ids IS NULL OR d.id IN $ids)
    AND (s:PR OR s:Commit) AND s.deleted_at IS NULL
    AND s.created_at > coalesce(d.valid_from, d.recorded_at)
    AND NOT (d)-[:IMPLEMENTED_BY]->(s)
    AND NOT (d)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s)
    AND ${visible("d")} AND ${visible("s")}
  OPTIONAL MATCH (c)<-[:OWNS]-(owner:Person)
  RETURN d.id AS id, d.title AS title, coalesce(d.valid_from, d.recorded_at) AS made,
         s.id AS source, s.title AS sourceTitle, s.url AS url, s.created_at AS at, c.path AS path,
         collect(DISTINCT owner.name) AS owners
  ORDER BY at DESC, source`;

export async function staleDecisions(ctx: BrainContext, ids?: string[]): Promise<StaleDecision[]> {
  const rows = await readAsCaller<Row>(ctx, CHANGES, { ids: ids ?? null });
  const byDecision = new Map<string, { title: string; made: string; changes: Map<string, CodeChange>; owners: Set<string> }>();
  for (const row of rows) {
    const decision = byDecision.get(row.id) ?? { title: row.title, made: day(row.made), changes: new Map(), owners: new Set() };
    byDecision.set(row.id, decision);
    const change = decision.changes.get(row.source) ?? { id: row.source, title: row.sourceTitle, url: row.url, date: day(row.at), paths: [] };
    decision.changes.set(row.source, change);
    if (!change.paths.includes(row.path)) change.paths.push(row.path);
    for (const owner of row.owners) decision.owners.add(owner);
  }
  return [...byDecision]
    .filter(([, d]) => d.changes.size >= STALE_AFTER)
    .map(([id, d]) => ({
      id,
      title: d.title,
      made: d.made,
      changes: [...d.changes.values()],
      owners: [...d.owners].sort(),
    }))
    .sort((a, b) => b.changes.length - a.changes.length || a.id.localeCompare(b.id));
}
