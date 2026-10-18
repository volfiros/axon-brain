import { FROM_CALLER, readAsCaller, restrictedNote, visible } from "./access";
import { day } from "./search";
import { decisionDetails, decisionPaths } from "./tools/recall";
import type { BrainContext } from "./tool";

export const NODE_TYPES = ["Decision", "Constraint", "Assumption", "Source", "Person", "Topic", "CodeUnit", "Excerpt"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export type GraphNode = {
  id: string;
  type: NodeType;
  kind: string | null;
  name: string;
  text: string | null;
  url: string | null;
  status: string | null;
};

export type GraphEdge = { source: string; target: string; type: string };

export type GraphView = { nodes: GraphNode[]; edges: GraphEdge[]; total: number; capped: boolean };

export type DecisionTrail = {
  id: string;
  title: string;
  statement: string;
  status: string;
  because: string[];
  hiddenReasons: string;
  rejected: string[];
  decidedBy: string;
  sources: { quote: string; title: string; url: string | null }[];
  hiddenSources: string;
  paths: { id: string; name: string }[][];
  pathNodes: string[];
  pathEdges: { source: string; target: string }[];
};

const NODE_CAP = 300;

const ANCHOR = "(n:Decision OR n:Source OR n:Constraint OR n:Assumption)";
const LIVE = (alias: string) => `${alias}.deleted_at IS NULL AND coalesce(${alias}.status, '') <> 'dismissed'`;

const FIELDS = `n.id AS id, [l IN labels(n) WHERE l IN $types][0] AS type,
  coalesce([l IN labels(n) WHERE NOT l IN $types][0], n.kind) AS kind,
  coalesce(n.name, n.title, n.statement, n.text, n.id) AS name,
  coalesce(n.statement, n.text, n.path, CASE WHEN n:Person THEN n.title END) AS text,
  n.url AS url, n.status AS status`;

const CORE: NodeType[] = ["Decision", "Constraint", "Assumption"];
const CHANGES_PER_DECISION = 5;

// Tier 1: what a decision was quoted from or points at. Tier 2: the newest sources that changed the code it affects.
// Only ids are read here; a node is drawn only if the visibility-filtered reads above also returned it.
const NEAR_DECISIONS = `
  ${FROM_CALLER}
  MATCH (d:Decision)-[:DERIVED_FROM]->(ex:Excerpt)-[:IN]->(s:Source)
  WHERE ${LIVE("d")} AND ${visible("d")}
  UNWIND [ex.id, s.id] AS id
  RETURN id, 1 AS tier
  UNION
  ${FROM_CALLER}
  MATCH (d:Decision)-[:MADE_BY|APPROVED_BY|ABOUT|AFFECTS|BECAUSE_OF]->(x)
  WHERE ${LIVE("d")} AND ${visible("d")}
  RETURN x.id AS id, 1 AS tier
  UNION
  ${FROM_CALLER}
  MATCH (d:Decision)-[:AFFECTS]->(:CodeUnit)<-[:TOUCHES]-(s:Source)
  WHERE ${LIVE("d")} AND ${visible("d")} AND s.deleted_at IS NULL
  WITH d, s ORDER BY s.created_at DESC
  WITH d, collect(DISTINCT s.id)[0..$perDecision] AS changes
  UNWIND changes AS id
  RETURN id, 2 AS tier`;

/**
 * The part of the workspace graph the caller can see, capped at NODE_CAP nodes. Decisions come first, then what links
 * them to their sources, people and code, then the PRs and commits that changed that code, then everything else.
 */
export async function graphView(ctx: BrainContext): Promise<GraphView> {
  const params = { types: [...NODE_TYPES] };
  const [anchors, reached, excerpts, near] = await Promise.all([
    readAsCaller<GraphNode>(ctx, `${FROM_CALLER} MATCH (n) WHERE ${ANCHOR} AND n.id IS NOT NULL AND ${LIVE("n")} AND ${visible("n")} RETURN ${FIELDS}`, params),
    // People, topics and code have no visibility of their own, so they appear only next to a visible node.
    readAsCaller<GraphNode>(
      ctx,
      `${FROM_CALLER}
       MATCH (a)-[r]-(n)
       WHERE (a:Decision OR a:Source OR a:Constraint OR a:Assumption) AND ${LIVE("a")} AND ${visible("a")}
         AND (n:Person OR n:Topic OR n:CodeUnit) AND n.id IS NOT NULL AND type(r) <> 'VISIBLE_TO'
       RETURN DISTINCT ${FIELDS}`,
      params,
    ),
    readAsCaller<GraphNode>(
      ctx,
      `${FROM_CALLER}
       MATCH (n:Excerpt)-[:IN]->(s:Source)
       WHERE n.id IS NOT NULL AND s.deleted_at IS NULL AND ${visible("s")}
       RETURN DISTINCT ${FIELDS}`,
      params,
    ),
    readAsCaller<{ id: string; tier: number }>(ctx, NEAR_DECISIONS, { perDecision: CHANGES_PER_DECISION }),
  ]);

  const byId = new Map<string, GraphNode>();
  for (const node of [...anchors, ...reached, ...excerpts]) if (!byId.has(node.id)) byId.set(node.id, node);
  const tiers = new Map<string, number>();
  for (const { id, tier } of near) tiers.set(id, Math.min(tier, tiers.get(id) ?? tier));
  const rank = (n: GraphNode) => (CORE.includes(n.type) ? 0 : (tiers.get(n.id) ?? 3));
  const all = [...byId.values()].sort(
    (a, b) => rank(a) - rank(b) || NODE_TYPES.indexOf(a.type) - NODE_TYPES.indexOf(b.type),
  );
  const nodes = all.slice(0, NODE_CAP);
  const ids = nodes.map((n) => n.id);

  // Every id here already passed the caller's visibility filter above, so edges between them reveal nothing new.
  const edges = await ctx.graph.roQuery<GraphEdge>(
    `MATCH (a)-[r]->(b) WHERE a.id IN $ids AND b.id IN $ids AND type(r) <> 'VISIBLE_TO'
     RETURN a.id AS source, b.id AS target, type(r) AS type`,
    { ids },
  );
  return { nodes, edges, total: all.length, capped: all.length > nodes.length };
}

/** A visible decision's details plus the node ids on recall's shortest paths to its source and its maker. */
export async function decisionTrail(ctx: BrainContext, id: string): Promise<DecisionTrail | null> {
  const [details, paths] = await Promise.all([decisionDetails(ctx, [id]), decisionPaths(ctx, [id])]);
  const d = details.get(id);
  if (!d) return null;
  const path = paths.get(id);
  const chains = [path?.sourceIds ?? [], path?.makerIds ?? []];
  // These ids come from recall's visible-only path query; names are read here so hops cut by the node cap still show.
  const names = await ctx.graph.roQuery<{ id: string; name: string }>(
    `MATCH (n) WHERE n.id IN $ids
     RETURN n.id AS id, CASE WHEN n:Excerpt THEN 'Quote' ELSE coalesce(n.name, n.title, n.id) END AS name`,
    { ids: chains.flat() },
  );
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const decided = [
    d.maker ?? "Unknown",
    d.approver ? `approved by ${d.approver}` : null,
    day(d.validFrom),
    d.validTo ? `replaced ${day(d.validTo)}` : null,
  ];
  return {
    id: d.id,
    title: d.title,
    statement: d.statement,
    status: d.status,
    because: d.because,
    hiddenReasons: await restrictedNote(ctx, d.hiddenReasons, "reason"),
    rejected: d.rejected,
    decidedBy: decided.filter(Boolean).join(", "),
    sources: d.sources.map(({ quote, title, url }) => ({ quote, title, url })),
    hiddenSources: await restrictedNote(ctx, d.hiddenSources, "source"),
    paths: chains.filter((chain) => chain.length > 1).map((chain) => chain.map((hop) => ({ id: hop, name: nameOf.get(hop) ?? hop }))),
    pathNodes: [...new Set([d.id, ...chains.flat()])],
    pathEdges: chains.flatMap((chain) => chain.slice(1).map((target, i) => ({ source: chain[i], target }))),
  };
}
