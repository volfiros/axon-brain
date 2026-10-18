import { withScratchGraph } from "@/lib/graph/client";
import { FROM_CALLER, readAsCaller, visible } from "./access";
import type { BrainContext } from "./tool";

const MAX_NODES = 3000;
const MAX_EDGES = 20000;
const BATCH = 5000;

const NODES = `
  MATCH (p:Person)
  RETURN 'person:' + p.id AS key
  UNION ALL
  ${FROM_CALLER}
  MATCH (d:Decision) WHERE d.status <> 'dismissed' AND ${visible("d")}
  RETURN DISTINCT 'decision:' + d.id AS key
  UNION ALL
  ${FROM_CALLER}
  MATCH (s:Source) WHERE s.deleted_at IS NULL AND ${visible("s")}
  RETURN DISTINCT 'source:' + s.id AS key`;

const EDGES = `
  ${FROM_CALLER}
  MATCH (d:Decision)-[:MADE_BY|APPROVED_BY]->(p:Person) WHERE d.status <> 'dismissed' AND ${visible("d")}
  RETURN DISTINCT 'decision:' + d.id AS a, 'person:' + p.id AS b
  UNION ALL
  ${FROM_CALLER}
  MATCH (p:Person)-[:AUTHORED]->(s:Source) WHERE s.deleted_at IS NULL AND ${visible("s")}
  RETURN DISTINCT 'person:' + p.id AS a, 'source:' + s.id AS b
  UNION ALL
  ${FROM_CALLER}
  MATCH (d:Decision)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)
  WHERE d.status <> 'dismissed' AND s.deleted_at IS NULL AND ${visible("d")} AND ${visible("s")}
  RETURN DISTINCT 'decision:' + d.id AS a, 'source:' + s.id AS b`;

export async function personCentrality(ctx: BrainContext): Promise<Map<string, number> | null> {
  const [nodes, edges] = await Promise.all([
    readAsCaller<{ key: string }>(ctx, NODES),
    readAsCaller<{ a: string; b: string }>(ctx, EDGES),
  ]);
  const keys = [...new Set(nodes.map((n) => n.key))];
  if (edges.length === 0 || keys.length > MAX_NODES || edges.length > MAX_EDGES) return null;

  const rows = await withScratchGraph(ctx.graph.name, async (scratch) => {
    await scratch.query("UNWIND $keys AS key CREATE (:N {key: key})", { keys });
    await scratch.query("CREATE INDEX FOR (n:N) ON (n.key)");
    for (let i = 0; i < edges.length; i += BATCH) {
      await scratch.query(
        `UNWIND $pairs AS pair
         MATCH (a:N {key: pair[0]}), (b:N {key: pair[1]})
         CREATE (a)-[:R]->(b), (b)-[:R]->(a)`,
        { pairs: edges.slice(i, i + BATCH).map((e) => [e.a, e.b]) },
      );
    }
    return scratch.roQuery<{ key: string; score: number }>(
      `CALL algo.pageRank('N', 'R') YIELD node, score
       WHERE node.key STARTS WITH 'person:'
       RETURN node.key AS key, score`,
    );
  });

  const max = Math.max(0, ...rows.map((r) => r.score));
  return new Map(rows.map((r) => [r.key.slice("person:".length), max > 0 ? r.score / max : 0]));
}
