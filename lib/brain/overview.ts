import { workspaceGraph } from "@/lib/graph/client";
import type { Member } from "@/lib/workspaces";

import { FROM_CALLER, readAsCaller, restrictedNote, visible } from "./access";
import { day } from "./search";
import { decisionDetails } from "./tools/recall";
import type { BrainContext } from "./tool";

export type DecisionStatus = "proposed" | "accepted" | "superseded";

export type DecisionView = {
  id: string;
  title: string;
  statement: string;
  status: DecisionStatus;
  restricted: boolean;
  maker: string | null;
  approver: string | null;
  date: string;
  replaced: string | null;
  because: string[];
  hiddenReasons: string;
  rejected: string[];
  affects: string[];
  sources: { quote: string; title: string; url: string | null }[];
  hiddenSources: string;
  supersedes: string[];
  supersededBy: string[];
};

export function memberContext(slug: string, member: Member): BrainContext {
  return {
    graph: workspaceGraph(slug),
    caller: { personId: member.personId, name: member.name, role: member.role, teams: [], workspace: slug },
  };
}

/** Decisions with the given statuses that the caller can see, newest first. Hidden ones are not counted. */
export async function listDecisions(ctx: BrainContext, statuses: DecisionStatus[]): Promise<DecisionView[]> {
  const rows = await readAsCaller<{ id: string; sensitivity: string | null; affects: string[] }>(
    ctx,
    `${FROM_CALLER}
     MATCH (d:Decision) WHERE d.status IN $statuses AND ${visible("d")}
     OPTIONAL MATCH (d)-[:AFFECTS]->(x)
     WITH d, collect(DISTINCT coalesce(x.path, x.name)) AS affects
     RETURN d.id AS id, d.sensitivity AS sensitivity, affects
     ORDER BY coalesce(d.valid_from, d.recorded_at) DESC, d.id
     LIMIT 200`,
    { statuses },
  );
  if (rows.length === 0) return [];
  const details = await decisionDetails(ctx, rows.map((r) => r.id));
  const views: DecisionView[] = [];
  for (const row of rows) {
    const d = details.get(row.id);
    if (!d) continue;
    views.push({
      id: d.id,
      title: d.title,
      statement: d.statement,
      status: d.status as DecisionStatus,
      restricted: row.sensitivity === "restricted",
      maker: d.maker,
      approver: d.approver,
      date: day(d.validFrom),
      replaced: d.validTo ? day(d.validTo) : null,
      because: d.because,
      hiddenReasons: await restrictedNote(ctx, d.hiddenReasons, "reason"),
      rejected: d.rejected,
      affects: row.affects,
      // collect() of a map keeps the all-null map an unmatched OPTIONAL MATCH leaves behind.
      sources: d.sources.filter((s) => s.quote).map(({ quote, title, url }) => ({ quote, title, url })),
      hiddenSources: await restrictedNote(ctx, d.hiddenSources, "source"),
      supersedes: d.supersedes,
      supersededBy: d.supersededBy,
    });
  }
  return views;
}
