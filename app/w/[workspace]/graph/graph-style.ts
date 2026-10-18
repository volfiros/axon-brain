import type { GraphNode } from "@/lib/brain/graph-view";

export type Highlight = { nodes: Set<string>; edges: Set<string>; zoom: boolean };

export const edgeKey = (source: string, target: string) => `${source}>${target}`;

export type Shape = "circle" | "ring" | "square" | "diamond";

// `token` is read from CSS at runtime for the canvas; `swatch` is the matching Tailwind class for the legend.
export type NodeStyle = { label: string; token: string; swatch: string; shape: Shape; size: number };

const SOURCE_COLORS = [
  { token: "--chart-1", swatch: "bg-chart-1" },
  { token: "--chart-2", swatch: "bg-chart-2" },
  { token: "--chart-3", swatch: "bg-chart-3" },
  { token: "--chart-4", swatch: "bg-chart-4" },
  { token: "--chart-5", swatch: "bg-chart-5" },
];

const DECISION_STYLES: Record<string, NodeStyle> = {
  accepted: { label: "Accepted decision", token: "--valid", swatch: "bg-valid", shape: "circle", size: 6 },
  proposed: { label: "Proposed decision", token: "--warning", swatch: "bg-warning", shape: "circle", size: 6 },
  superseded: { label: "Superseded decision", token: "--muted-foreground", swatch: "bg-muted-foreground", shape: "circle", size: 6 },
};

const TYPE_STYLES: Record<Exclude<GraphNode["type"], "Decision" | "Source">, NodeStyle> = {
  Constraint: { label: "Constraint", token: "--muted-foreground", swatch: "bg-muted-foreground", shape: "diamond", size: 4.5 },
  Assumption: { label: "Assumption", token: "--secondary-foreground", swatch: "bg-secondary-foreground", shape: "diamond", size: 4.5 },
  Person: { label: "Person", token: "--foreground", swatch: "bg-foreground", shape: "circle", size: 4.5 },
  Topic: { label: "Topic", token: "--secondary-foreground", swatch: "border-2 border-secondary-foreground", shape: "ring", size: 4 },
  CodeUnit: { label: "Code", token: "--muted-foreground", swatch: "bg-muted-foreground", shape: "square", size: 4 },
  Excerpt: { label: "Excerpt", token: "--muted-foreground", swatch: "bg-muted-foreground", shape: "circle", size: 2 },
};

export const BASE_TOKENS = ["--foreground", "--border", "--muted-foreground"];

export function sourceKinds(nodes: GraphNode[]): string[] {
  return [...new Set(nodes.filter((n) => n.type === "Source").map((n) => n.kind ?? "Source"))].sort();
}

export function nodeStyle(node: GraphNode, kinds: string[]): NodeStyle {
  if (node.type === "Decision") return DECISION_STYLES[node.status ?? ""] ?? DECISION_STYLES.proposed;
  if (node.type === "Source") {
    const kind = node.kind ?? "Source";
    const color = SOURCE_COLORS[Math.max(0, kinds.indexOf(kind)) % SOURCE_COLORS.length];
    return { label: kind, ...color, shape: "square", size: 5 };
  }
  return TYPE_STYLES[node.type];
}

/** One legend entry per style that appears in the graph, in a stable order. */
export function legend(nodes: GraphNode[], kinds: string[]): NodeStyle[] {
  const seen = new Map<string, NodeStyle>();
  for (const node of nodes) {
    const style = nodeStyle(node, kinds);
    seen.set(style.label, style);
  }
  const order = [...Object.values(DECISION_STYLES), ...kinds.map((k) => ({ label: k })), ...Object.values(TYPE_STYLES)].map((s) => s.label);
  return [...seen.values()].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
}

export function tokensFor(nodes: GraphNode[], kinds: string[]): string[] {
  return [...new Set([...BASE_TOKENS, ...nodes.map((n) => nodeStyle(n, kinds).token)])];
}
