import { withScratchGraph, type AxonGraph } from "@/lib/graph/client";
import { FROM_CALLER, readAsCaller, visible } from "./access";
import type { BrainContext } from "./tool";

export const MAX_NODES = 3000;
export const MAX_EDGES = 20000;
const BATCH = 5000;

export type ProjectedNode = { key: string; kind: string; name: string };
export type ProjectedEdge = { a: string; b: string; type: string };

const live = (d: string) => `${d}.status <> 'dismissed' AND ${visible(d)}`;
const source = (s: string) => `${s}.deleted_at IS NULL AND ${visible(s)}`;
const kindOf = (s: string) => `coalesce([l IN labels(${s}) WHERE l <> 'Source'][0], 'Source')`;

const NODES = `
  MATCH (p:Person)
  RETURN 'person:' + p.id AS key, 'Person' AS kind, coalesce(p.name, p.id) AS name
  UNION ALL
  ${FROM_CALLER}
  MATCH (d:Decision) WHERE ${live("d")}
  RETURN DISTINCT 'decision:' + d.id AS key, 'Decision' AS kind, coalesce(d.title, d.id) AS name
  UNION ALL
  ${FROM_CALLER}
  MATCH (s:Source) WHERE ${source("s")}
  RETURN DISTINCT 'source:' + s.id AS key, ${kindOf("s")} AS kind, coalesce(s.key + ' ' + s.title, s.title, s.id) AS name
  UNION ALL
  MATCH (c:CodeUnit)
  RETURN 'code:' + c.id AS key, 'CodeUnit' AS kind, coalesce(c.path, c.id) AS name`;

const EDGES = `
  ${FROM_CALLER}
  MATCH (d:Decision)-[r:MADE_BY|APPROVED_BY]->(p:Person) WHERE ${live("d")}
  RETURN DISTINCT 'decision:' + d.id AS a, 'person:' + p.id AS b, type(r) AS type
  UNION ALL
  ${FROM_CALLER}
  MATCH (p:Person)-[:AUTHORED]->(s:Source) WHERE ${source("s")}
  RETURN DISTINCT 'person:' + p.id AS a, 'source:' + s.id AS b, 'AUTHORED' AS type
  UNION ALL
  ${FROM_CALLER}
  MATCH (d:Decision)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source) WHERE ${live("d")} AND ${source("s")}
  RETURN DISTINCT 'decision:' + d.id AS a, 'source:' + s.id AS b, 'DERIVED_FROM' AS type
  UNION ALL
  ${FROM_CALLER}
  MATCH (d:Decision)-[:SUPERSEDES]->(old:Decision) WHERE ${live("d")} AND ${live("old")}
  RETURN DISTINCT 'decision:' + d.id AS a, 'decision:' + old.id AS b, 'SUPERSEDES' AS type
  UNION ALL
  ${FROM_CALLER}
  MATCH (d:Decision)-[:AFFECTS]->(c:CodeUnit) WHERE ${live("d")}
  RETURN DISTINCT 'decision:' + d.id AS a, 'code:' + c.id AS b, 'AFFECTS' AS type
  UNION ALL
  ${FROM_CALLER}
  MATCH (s:Source)-[r:REFERENCES|PART_OF]->(t:Source) WHERE ${source("s")} AND ${source("t")}
  RETURN DISTINCT 'source:' + s.id AS a, 'source:' + t.id AS b, type(r) AS type
  UNION ALL
  ${FROM_CALLER}
  MATCH (s:Source)-[:TOUCHES]->(c:CodeUnit) WHERE ${source("s")}
  RETURN DISTINCT 'source:' + s.id AS a, 'code:' + c.id AS b, 'TOUCHES' AS type`;

/** Runs `fn` on a temporary copy of what the caller can see. Null when it is empty or too large. */
export async function withVisibleProjection<T>(
  ctx: BrainContext,
  fn: (scratch: AxonGraph, nodes: Map<string, ProjectedNode>) => Promise<T>,
): Promise<T | null> {
  const [nodeRows, edgeRows] = await Promise.all([
    readAsCaller<ProjectedNode>(ctx, NODES),
    readAsCaller<ProjectedEdge>(ctx, EDGES),
  ]);
  // Unlinked code units would reveal paths only restricted work touched.
  const linked = new Set(edgeRows.flatMap((e) => [e.a, e.b]));
  const nodes = new Map(nodeRows.filter((n) => n.kind !== "CodeUnit" || linked.has(n.key)).map((n) => [n.key, n]));
  const edges = edgeRows.filter((e) => nodes.has(e.a) && nodes.has(e.b));
  if (edges.length === 0 || nodes.size > MAX_NODES || edges.length > MAX_EDGES) return null;
  return withScratchGraph(ctx.graph.name, async (scratch) => {
    await loadProjection(scratch, [...nodes.values()], edges);
    return fn(scratch, nodes);
  });
}

// Each edge is written both ways so the algorithms treat the graph as undirected.
export async function loadProjection(
  scratch: AxonGraph,
  nodes: { key: string; kind?: string; name?: string }[],
  edges: { a: string; b: string; type?: string }[],
) {
  await scratch.query("UNWIND $nodes AS n CREATE (:N {key: n[0], kind: n[1], name: n[2]})", {
    nodes: nodes.map((n) => [n.key, n.kind ?? null, n.name ?? null]),
  });
  await scratch.query("CREATE INDEX FOR (n:N) ON (n.key)");
  for (let i = 0; i < edges.length; i += BATCH) {
    await scratch.query(
      `UNWIND $pairs AS pair
       MATCH (a:N {key: pair[0]}), (b:N {key: pair[1]})
       CREATE (a)-[:R {type: pair[2]}]->(b), (b)-[:R {type: pair[2]}]->(a)`,
      { pairs: edges.slice(i, i + BATCH).map((e) => [e.a, e.b, e.type ?? null]) },
    );
  }
}
