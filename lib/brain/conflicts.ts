import { FROM_CALLER, readAsCaller, shown, visible } from "./access";
import { sourceChanged } from "./source-changes";
import type { BrainContext } from "./tool";

const SOURCE_RANKS = [
  { labels: ["Doc"], name: "a doc" },
  { labels: ["WorkItem", "PR", "Commit"], name: "a work item or PR" },
  { labels: ["Message", "Thread", "Meeting", "Conversation"], name: "a message or conversation" },
];
const NO_SOURCE_NAME = "no source you can see";
const MAX_PAIRS = 200;

type Pair = { aId: string; aTitle: string; aStatement: string; bId: string; bTitle: string; bStatement: string; targets: string[] };
type Backing = { id: string; at: unknown; labels: string[] | null; changed: boolean };

export type Conflict = {
  decisions: { id: string; title: string; statement: string; source: string }[];
  targets: string[];
  likely: { id: string; reason: "source" | "newer" } | null;
};

export async function possibleConflicts(ctx: BrainContext): Promise<Conflict[]> {
  const pairs = await readAsCaller<Pair>(
    ctx,
    `${FROM_CALLER}
     MATCH (a:Decision {status: 'accepted'})-[:ABOUT|AFFECTS]->(x)<-[:ABOUT|AFFECTS]-(b:Decision {status: 'accepted'})
     WHERE a.id < b.id AND ${visible("a")} AND ${visible("b")} AND ${shown("x")}
     RETURN a.id AS aId, a.title AS aTitle, a.statement AS aStatement, b.id AS bId, b.title AS bTitle, b.statement AS bStatement,
            collect(DISTINCT coalesce(x.path, x.name)) AS targets
     ORDER BY size(targets) DESC, aId, bId
     LIMIT $max`,
    { max: MAX_PAIRS },
  );
  if (pairs.length === 0) return [];

  const ids = [...new Set(pairs.flatMap((p) => [p.aId, p.bId]))];
  const backing = await readAsCaller<Backing>(
    ctx,
    `${FROM_CALLER}
     MATCH (d:Decision) WHERE d.id IN $ids AND ${visible("d")}
     OPTIONAL MATCH (d)-[link:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source) WHERE ${visible("s")}
     RETURN DISTINCT d.id AS id, coalesce(d.valid_from, d.recorded_at) AS at, labels(s) AS labels,
            coalesce(${sourceChanged("link", "s")}, false) AS changed`,
    { ids },
  );
  const strength = new Map<string, { rank: number; at: string }>();
  const flagged = new Set(backing.filter((row) => row.changed).map((row) => row.id));
  for (const row of backing) {
    const found = SOURCE_RANKS.findIndex((r) => r.labels.some((l) => row.labels?.includes(l)));
    const rank = found === -1 ? SOURCE_RANKS.length : found;
    const best = strength.get(row.id);
    if (!best || rank < best.rank) strength.set(row.id, { rank, at: String(row.at ?? "") });
  }

  const current = pairs.filter((p) => !flagged.has(p.aId) && !flagged.has(p.bId));
  return current.map((p) => {
    const a = strength.get(p.aId) ?? { rank: SOURCE_RANKS.length, at: "" };
    const b = strength.get(p.bId) ?? { rank: SOURCE_RANKS.length, at: "" };
    const likely =
      a.rank !== b.rank
        ? { id: a.rank < b.rank ? p.aId : p.bId, reason: "source" as const }
        : a.at !== b.at
          ? { id: a.at > b.at ? p.aId : p.bId, reason: "newer" as const }
          : null;
    return {
      decisions: [
        { id: p.aId, title: p.aTitle, statement: p.aStatement, source: SOURCE_RANKS[a.rank]?.name ?? NO_SOURCE_NAME },
        { id: p.bId, title: p.bTitle, statement: p.bStatement, source: SOURCE_RANKS[b.rank]?.name ?? NO_SOURCE_NAME },
      ],
      targets: p.targets,
      likely,
    };
  });
}
