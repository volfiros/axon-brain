import { z } from "zod";
import type { AxonGraph } from "@/lib/graph/client";
import { MAX_NODES, withVisibleProjection, type ProjectedNode } from "../projection";
import { defineTool } from "../tool";

const MAX_PATH = 8;
const TOO_LARGE = `Nothing to analyse, or more than ${MAX_NODES} nodes.`;

type Nodes = Map<string, ProjectedNode>;

const label = (n: { kind: string; name: string }) => `(${n.kind}: ${n.name})`;

async function betweenness(scratch: AxonGraph, limit: number): Promise<string> {
  const rows = await scratch.roQuery<{ kind: string; name: string; score: number }>(
    `CALL algo.betweenness({nodeLabels: ['N'], relationshipTypes: ['R']}) YIELD node, score
     WHERE node.kind = 'Person' AND score > 0
     RETURN node.kind AS kind, node.name AS name, score
     ORDER BY score DESC, name LIMIT $limit`,
    { limit },
  );
  if (rows.length === 0) return "No person bridges separate parts of the graph.";
  const max = rows[0].score;
  return [
    "People who bridge separate parts of the work (betweenness, 1.00 = highest):",
    ...rows.map((r) => `- ${r.name}: ${(r.score / max).toFixed(2)}`),
  ].join("\n");
}

async function components(scratch: AxonGraph, limit: number): Promise<string> {
  const rows = await scratch.roQuery<{ component: number; kind: string; name: string }>(
    `CALL algo.WCC({nodeLabels: ['N'], relationshipTypes: ['R']}) YIELD node, componentId
     RETURN componentId AS component, node.kind AS kind, node.name AS name`,
  );
  const groups = new Map<number, { kind: string; name: string }[]>();
  for (const row of rows) groups.set(row.component, [...(groups.get(row.component) ?? []), row]);
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
  const islands = sorted.slice(1).filter((g) => g.some((n) => n.kind === "Decision"));
  const lines = [`${sorted.length} groups. Largest: ${sorted[0]?.length ?? 0} of ${rows.length} items.`];
  if (islands.length === 0) {
    lines.push("No decision is cut off from the main group.");
  } else {
    lines.push(`${islands.length} groups with decisions cut off from the main group:`);
    for (const group of islands.slice(0, limit)) {
      const shown = group.slice(0, 5).map(label).join(", ");
      lines.push(`- ${shown}${group.length > 5 ? ` and ${group.length - 5} more` : ""}`);
    }
  }
  return lines.join("\n");
}

export function findNode(nodes: Nodes, text: string): ProjectedNode | string {
  const wanted = text.trim().toLowerCase();
  const all = [...nodes.values()];
  const exact = all.filter((n) => [n.key, n.key.slice(n.key.indexOf(":") + 1), n.name].some((v) => v.toLowerCase() === wanted));
  const matches = exact.length > 0 ? exact : all.filter((n) => n.name.toLowerCase().includes(wanted));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) return `Nothing you can see matches "${text}".`;
  return [`"${text}" matches several. Use an id:`, ...matches.slice(0, 10).map((n) => `- ${n.key} ${label(n)}`)].join("\n");
}

async function shortestPath(scratch: AxonGraph, nodes: Nodes, from?: string, to?: string): Promise<string> {
  if (!from || !to) return "shortest_path needs both from and to.";
  const a = findNode(nodes, from);
  if (typeof a === "string") return a;
  const b = findNode(nodes, to);
  if (typeof b === "string") return b;
  if (a.key === b.key) return `${label(a)} is the same item.`;
  const [row] = await scratch.roQuery<{ names: string[]; kinds: string[]; types: string[] }>(
    `MATCH (a:N {key: $a}), (b:N {key: $b})
     CALL algo.SPpaths({sourceNode: a, targetNode: b, relTypes: ['R'], maxLen: $maxLen, pathCount: 1}) YIELD path
     RETURN [n IN nodes(path) | n.name] AS names, [n IN nodes(path) | n.kind] AS kinds, [r IN relationships(path) | r.type] AS types`,
    { a: a.key, b: b.key, maxLen: MAX_PATH },
  );
  if (!row) return `No path within ${MAX_PATH} steps between ${label(a)} and ${label(b)}.`;
  const steps = row.names.map((name, i) => label({ kind: row.kinds[i], name }));
  const path = steps.map((step, i) => (i === 0 ? step : `-[${row.types[i - 1]}]-${step}`)).join("");
  return `${row.types.length} step${row.types.length === 1 ? "" : "s"}:\n${path}`;
}

export default defineTool({
  name: "graph_algorithm",
  description:
    "Runs a graph algorithm over what you can see. betweenness: people who bridge parts of the team. " +
    "components: decisions cut off from the rest. shortest_path: how two things connect (from, to: an id or name).",
  inputSchema: z.object({
    algorithm: z.enum(["betweenness", "components", "shortest_path"]),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  readOnly: true,
  async handler({ algorithm, from, to, limit }, ctx) {
    const result = await withVisibleProjection(ctx, (scratch, nodes) => {
      if (algorithm === "betweenness") return betweenness(scratch, limit);
      if (algorithm === "components") return components(scratch, limit);
      return shortestPath(scratch, nodes, from, to);
    });
    return result ?? TOO_LARGE;
  },
});
