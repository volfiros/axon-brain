import { z } from "zod";
import { FROM_CALLER, readAsCaller, restrictedNote, visible } from "../access";
import { day, searchTerms } from "../search";
import { sourceChangeRow, sourceChanged, type SourceChange } from "../source-changes";
import { defineTool, type BrainContext } from "../tool";

const NEIGHBOR = "(x:Topic OR x:CodeUnit OR x:Process OR x:Project) AND any(w IN $stems WHERE toLower(x.name) CONTAINS w OR toLower(coalesce(x.path, '')) CONTAINS w)";

// Three ways in: the decision's own text, the quote it came from, or a topic, file or process it is linked to.
const ENTRY_POINTS = (filter: string, ret: string) => `
  ${FROM_CALLER}
  CALL db.idx.fulltext.queryNodes('Decision', $q) YIELD node AS d, score
  WITH u, role, d, score, '' AS via
  WHERE ${filter}
  ${ret}
  UNION ALL
  ${FROM_CALLER}
  CALL db.idx.fulltext.queryNodes('Excerpt', $q) YIELD node AS ex, score
  MATCH (d:Decision)-[:DERIVED_FROM]->(ex)
  WITH u, role, d, score, '' AS via
  WHERE ${filter}
  ${ret}
  UNION ALL
  ${FROM_CALLER}
  MATCH (x) WHERE ${NEIGHBOR}
  MATCH (d:Decision)-[rel:ABOUT|AFFECTS]->(x)
  WITH u, role, d, 1.0 AS score, '(' + labels(x)[0] + ': ' + coalesce(x.path, x.name) + ')<-[:' + type(rel) + ']-' AS via
  WHERE ${filter}
  ${ret}`;

type Entry = { id: string; status: string; score: number; coverage: number; via: string };

export type Detail = {
  id: string;
  title: string;
  statement: string;
  status: string;
  confirmedBy: string | null;
  validFrom: string | null;
  validTo: string | null;
  maker: string | null;
  approver: string | null;
  because: string[];
  hiddenReasons: number;
  rejected: string[];
  sources: { quote: string; title: string; url: string | null; kind: string }[];
  hiddenSources: number;
  sourceChanges: SourceChange[];
  supersedes: string[];
  supersededBy: string[];
};

const STATUS_RANK: Record<string, number> = { accepted: 0, proposed: 1, superseded: 2 };

export default defineTool({
  name: "recall",
  description:
    "Answers a plain-language question from the team's saved decisions, with the reason, rejected alternatives, who decided and when, " +
    "the source quote and the graph path. Use it before changing code or a process the team may have decided on.",
  inputSchema: z.object({
    question: z.string().describe("The question, for example 'why do we skip duplicate webhook events?'"),
    limit: z.number().int().min(1).max(5).default(3).describe("How many decisions to show at most."),
  }),
  readOnly: true,
  async handler({ question, limit }, ctx) {
    const { fulltext, stems } = searchTerms(question);
    if (!fulltext) return "Ask with a few specific words, for example a file, process or topic name.";
    const params = { q: fulltext, stems };

    const entries = await readAsCaller<Entry>(
      ctx,
      ENTRY_POINTS(`d.status <> 'dismissed' AND ${visible("d")}`, "RETURN d.id AS id, d.status AS status, score, via, size([w IN $stems WHERE toLower(d.title + ' ' + d.statement) CONTAINS w]) AS coverage"),
      params,
    );
    const hiddenCounts = await readAsCaller<{ hidden: number }>(
      ctx,
      ENTRY_POINTS(`d.status <> 'dismissed' AND NOT ${visible("d")}`, "RETURN count(DISTINCT d) AS hidden"),
      params,
    );
    const hidden = Math.max(0, ...hiddenCounts.map((r) => r.hidden));
    const notes = await contextNotes(ctx, fulltext);

    const ranked = rank(entries).slice(0, limit);
    if (ranked.length === 0 && notes.length === 0) {
      return (await restrictedNote(ctx, hidden, "decision")) || "Nothing saved in this workspace matches that question.";
    }

    const ids = ranked.map((r) => r.id);
    const [details, graphPaths, related] = await Promise.all([
      decisionDetails(ctx, ids),
      decisionPaths(ctx, ids),
      relatedSources(ctx, ids),
    ]);
    const blocks: string[] = [];
    if (ranked.length > 0) {
      const top = details.get(ranked[0].id)!;
      blocks.push(`Answer: ${top.statement}${label(top) === "accepted" ? "" : ` (${label(top)})`}`);
    }
    for (const entry of ranked) {
      const detail = details.get(entry.id);
      if (detail) blocks.push(await renderDecision(ctx, detail, entry.paths, graphPaths.get(entry.id)) + relatedLine(related.get(entry.id)));
    }
    if (notes.length > 0) {
      blocks.push(["Context notes:", ...notes.map((n) => `- "${n.quote}" (${n.title}${n.url ? `, ${n.url}` : ""})`)].join("\n"));
    }
    const restricted = await restrictedNote(ctx, hidden, "decision");
    if (restricted) blocks.push(restricted.replace("There is", "There is also").replace("There are", "There are also"));
    return blocks.join("\n\n");
  },
});

// Full-text scores vary a lot between nodes, so the main signal is how many question words the decision itself uses.
export function rank(entries: Entry[]) {
  const byId = new Map<string, { id: string; status: string; score: number; coverage: number; paths: string[] }>();
  for (const e of entries) {
    const hit = byId.get(e.id) ?? { id: e.id, status: e.status, score: 0, coverage: e.coverage, paths: [] };
    hit.score += e.score;
    if (!hit.paths.includes(e.via)) hit.paths.push(e.via);
    byId.set(e.id, hit);
  }
  const superseded = (h: { status: string }) => (h.status === "superseded" ? 1 : 0);
  return [...byId.values()].sort(
    (a, b) =>
      superseded(a) - superseded(b) ||
      b.coverage - a.coverage ||
      (STATUS_RANK[a.status] ?? 1) - (STATUS_RANK[b.status] ?? 1) ||
      b.score - a.score,
  );
}

export function label(d: Detail): string {
  if (d.status === "superseded") return "superseded";
  return d.status === "accepted" && d.confirmedBy ? "accepted" : "proposed";
}

export async function decisionDetails(ctx: BrainContext, ids: string[]): Promise<Map<string, Detail>> {
  const rows = await readAsCaller<Detail>(
    ctx,
    `${FROM_CALLER}
     MATCH (d:Decision) WHERE d.id IN $ids AND ${visible("d")}
     OPTIONAL MATCH (d)-[:MADE_BY]->(maker:Person)
     OPTIONAL MATCH (d)-[:APPROVED_BY]->(approver:Person)
     WITH u, role, d, maker, approver
     OPTIONAL MATCH (d)-[:BECAUSE_OF]->(r) WHERE r:Feedback OR ${visible("r")}
     WITH u, role, d, maker, approver, collect(DISTINCT coalesce(r.statement, r.text)) AS because
     OPTIONAL MATCH (d)-[:BECAUSE_OF]->(h) WHERE NOT (h:Feedback OR ${visible("h")})
     WITH u, role, d, maker, approver, because, count(DISTINCT h) AS hiddenReasons
     OPTIONAL MATCH (d)-[:CONSIDERED]->(alt:Alternative)
     WITH u, role, d, maker, approver, because, hiddenReasons,
          collect(DISTINCT alt.title + ': ' + coalesce(alt.reason_rejected, 'no reason recorded')) AS rejected
     // An unmatched OPTIONAL MATCH collects one all-null map, so it is filtered out below.
     OPTIONAL MATCH (d)-[:DERIVED_FROM]->(ex:Excerpt)-[:IN]->(s:Source) WHERE ${visible("s")}
     WITH u, role, d, maker, approver, because, hiddenReasons, rejected,
          [x IN collect(DISTINCT {quote: ex.text, title: s.title, url: s.url, kind: [l IN labels(s) WHERE l <> 'Source'][0]}) WHERE x.quote IS NOT NULL] AS sources
     OPTIONAL MATCH (d)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(hs:Source) WHERE NOT ${visible("hs")}
     WITH u, role, d, maker, approver, because, hiddenReasons, rejected, sources, count(DISTINCT hs) AS hiddenSources
     // Only Sources the caller can see are checked, so a flag never reveals a hidden Source.
     OPTIONAL MATCH (d)-[link:DERIVED_FROM]->(:Excerpt)-[:IN]->(cs:Source)
     WHERE d.status = 'accepted' AND ${visible("cs")} AND ${sourceChanged("link", "cs")}
     WITH u, role, d, maker, approver, because, hiddenReasons, rejected, sources, hiddenSources,
          [c IN collect(DISTINCT ${sourceChangeRow("link", "cs")}) WHERE c.title IS NOT NULL] AS sourceChanges
     OPTIONAL MATCH (d)-[:SUPERSEDES]->(old:Decision) WHERE ${visible("old")}
     WITH u, role, d, maker, approver, because, hiddenReasons, rejected, sources, hiddenSources, sourceChanges, collect(DISTINCT old.title) AS supersedes
     OPTIONAL MATCH (newer:Decision)-[:SUPERSEDES]->(d) WHERE ${visible("newer")}
     RETURN d.id AS id, d.title AS title, d.statement AS statement, d.status AS status, d.confirmed_by AS confirmedBy,
            d.valid_from AS validFrom, d.valid_to AS validTo, maker.name AS maker, approver.name AS approver,
            because, hiddenReasons, rejected, sources, hiddenSources, sourceChanges, supersedes, collect(DISTINCT newer.title) AS supersededBy`,
    { ids },
  );
  return new Map(rows.map((r) => [r.id, r]));
}

export type GraphPaths = {
  id: string;
  sourceNodes: string[] | null;
  sourceRels: string[] | null;
  sourceIds: string[] | null;
  makerNodes: string[] | null;
  makerRels: string[] | null;
  makerIds: string[] | null;
};

const HOP_LABEL = "[l IN labels(n) WHERE l <> 'Source'][0]";
const HOP = `'(' + coalesce(${HOP_LABEL} + ': ' + coalesce(n.name, n.title), ${HOP_LABEL}) + ')'`;

/** The directed shortest paths from each visible decision to one visible source and to its maker, as rendered hops. */
export async function decisionPaths(ctx: BrainContext, ids: string[]): Promise<Map<string, GraphPaths>> {
  const rows = await readAsCaller<GraphPaths>(
    ctx,
    `${FROM_CALLER}
     MATCH (d:Decision) WHERE d.id IN $ids AND ${visible("d")}
     OPTIONAL MATCH (d)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source) WHERE ${visible("s")}
     WITH d, s ORDER BY s.id
     WITH d, collect(s)[0] AS s
     OPTIONAL MATCH (d)-[:MADE_BY]->(p:Person)
     WITH d, s, p,
          CASE WHEN s IS NULL THEN null ELSE shortestPath((d)-[:DERIVED_FROM|IN*..2]->(s)) END AS toSource,
          CASE WHEN p IS NULL THEN null ELSE shortestPath((d)-[:MADE_BY]->(p)) END AS toMaker
     RETURN d.id AS id,
            [n IN nodes(toSource) | ${HOP}] AS sourceNodes, [r IN relationships(toSource) | '-[:' + type(r) + ']->'] AS sourceRels,
            [n IN nodes(toMaker) | ${HOP}] AS makerNodes, [r IN relationships(toMaker) | '-[:' + type(r) + ']->'] AS makerRels,
            [n IN nodes(toSource) | n.id] AS sourceIds, [n IN nodes(toMaker) | n.id] AS makerIds`,
    { ids },
  );
  return new Map(rows.map((r) => [r.id, r]));
}

type Related = { title: string; url: string | null };

const RELATED_LIMIT = 5;

/** Sources a decision's own Sources reference, or are referenced by. Both ends must be visible to the caller. */
async function relatedSources(ctx: BrainContext, ids: string[]): Promise<Map<string, Related[]>> {
  const rows = await readAsCaller<{ id: string; related: Related[] }>(
    ctx,
    `${FROM_CALLER}
     MATCH (d:Decision) WHERE d.id IN $ids AND ${visible("d")}
     MATCH (d)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)-[:REFERENCES]-(t:Source)
     WHERE ${visible("s")} AND ${visible("t")} AND t.deleted_at IS NULL
       AND NOT (d)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(t)
     WITH d, t ORDER BY t.title
     RETURN d.id AS id, collect(DISTINCT {title: t.title, url: t.url})[0..${RELATED_LIMIT}] AS related`,
    { ids },
  );
  return new Map(rows.map((r) => [r.id, r.related]));
}

function relatedLine(related: Related[] | undefined): string {
  if (!related?.length) return "";
  return `\nRelated: ${related.map((r) => `${r.title}${r.url ? ` (${r.url})` : ""}`).join("; ")}`;
}

export function hops(nodes: string[] | null, rels: string[] | null): string {
  return (nodes ?? []).map((node, i) => (i === 0 ? node : `${rels?.[i - 1] ?? ""}${node}`)).join("");
}

async function renderDecision(ctx: BrainContext, d: Detail, paths: string[], graphPaths?: GraphPaths): Promise<string> {
  const lines = [`Decision: ${d.title} (${label(d)}, ${d.id})`];
  const hiddenReasons = await restrictedNote(ctx, d.hiddenReasons, "reason");
  lines.push(`Because: ${d.because.join("; ") || "no reason you can see"}${hiddenReasons ? `. ${hiddenReasons}` : ""}`);
  lines.push(`Rejected: ${d.rejected.join("; ") || "no alternatives recorded"}`);
  const approved = d.approver ? `, approved by ${d.approver}` : "";
  lines.push(`Decided by: ${d.maker ?? "unknown"}${approved}, ${day(d.validFrom)}${d.validTo ? `, replaced ${day(d.validTo)}` : ""}`);
  for (const s of d.sources) {
    lines.push(`Source: "${s.quote}" (${s.title}${s.url ? `, ${s.url}` : ""})`);
  }
  if (d.sources.length === 0) lines.push("Source: none you can see");
  const hiddenSources = await restrictedNote(ctx, d.hiddenSources, "source");
  if (hiddenSources) lines.push(hiddenSources);
  for (const c of d.sourceChanges) lines.push(sourceChangeLine(c));
  if (d.supersedes.length) lines.push(`Supersedes: ${d.supersedes.join("; ")}`);
  if (d.supersededBy.length) lines.push(`Superseded by: ${d.supersededBy.join("; ")}`);
  const entry = paths.find(Boolean) ?? "";
  const toSource = hops(graphPaths?.sourceNodes ?? null, graphPaths?.sourceRels ?? null) || `(Decision: ${d.title})`;
  const toMaker = hops(graphPaths?.makerNodes ?? null, graphPaths?.makerRels ?? null);
  const history = d.supersedes.map((title) => `; (Decision)-[:SUPERSEDES]->(Decision: ${title})`).join("");
  lines.push(`Path: ${entry}${toSource}${toMaker ? `; ${toMaker}` : ""}${history}`);
  return lines.join("\n");
}

export function sourceChangeLine(c: SourceChange): string {
  return `The source "${c.title}" for this decision was ${c.change} on ${day(c.at)}; review it, then confirm it still holds with review_source_changes or replace it with supersede.`;
}

async function contextNotes(ctx: BrainContext, q: string) {
  return readAsCaller<{ quote: string; title: string; url: string | null }>(
    ctx,
    `${FROM_CALLER}
     CALL db.idx.fulltext.queryNodes('Excerpt', $q) YIELD node AS ex, score
     MATCH (ex)-[:IN]->(s:Source)
     WHERE NOT (:Decision)-[:DERIVED_FROM]->(ex) AND NOT (:Constraint)-[:DERIVED_FROM]->(ex)
       AND NOT (:Assumption)-[:DERIVED_FROM]->(ex) AND ${visible("s")}
     RETURN coalesce(s.summary, ex.text) AS quote, s.title AS title, s.url AS url
     ORDER BY score DESC LIMIT 3`,
    { q },
  );
}
