"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";

import type { GraphEdge, GraphNode } from "@/lib/brain/graph-view";

import { edgeKey, nodeStyle, tokensFor, type Highlight } from "./graph-style";

type Node = NodeObject<GraphNode>;
type Link = LinkObject<GraphNode, GraphEdge>;

// force-graph swaps link ends from ids to node objects once the simulation starts.
const endId = (end: unknown) => String(typeof end === "object" && end ? (end as Node).id : end);

// Canvas cannot read CSS variables, so each theme token is resolved to a concrete color through a hidden probe.
function resolveColors(host: HTMLElement, tokens: string[]): Record<string, string> {
  const probe = document.createElement("span");
  probe.hidden = true;
  host.appendChild(probe);
  const colors: Record<string, string> = {};
  for (const token of tokens) {
    probe.style.color = `var(${token})`;
    colors[token] = getComputedStyle(probe).color;
  }
  probe.remove();
  return colors;
}

export default function GraphCanvas({
  nodes,
  edges,
  kinds,
  highlight,
  selectedId,
  onNodeClick,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  kinds: string[];
  highlight: Highlight | null;
  selectedId: string | null;
  onNodeClick: (id: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraphMethods<Node, Link>>(undefined);
  const fitted = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [colors, setColors] = useState<Record<string, string>>({});
  const [hoverId, setHoverId] = useState<string | null>(null);

  const hovered = useMemo<Highlight | null>(() => {
    if (!hoverId) return null;
    const near = edges.filter((e) => e.source === hoverId || e.target === hoverId);
    return {
      nodes: new Set([hoverId, ...near.flatMap((e) => [e.source, e.target])]),
      edges: new Set(near.map((e) => edgeKey(e.source, e.target))),
      zoom: false,
    };
  }, [hoverId, edges]);
  const active = highlight ?? hovered;

  const data = useMemo(() => ({ nodes: nodes.map((n) => ({ ...n })), links: edges.map((e) => ({ ...e })) }), [nodes, edges]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // next-themes switches the class on <html> after child effects run, so the palette follows that class instead.
  useEffect(() => {
    const read = () => wrap.current && setColors(resolveColors(wrap.current, tokensFor(nodes, kinds)));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [nodes, kinds]);

  const ready = size.width > 0;
  useEffect(() => {
    if (ready) graph.current?.d3Force("charge")?.strength(-90);
  }, [ready]);

  const pad = Math.round(Math.min(size.width, size.height) / 5);
  const fit = useCallback(
    (h: Highlight | null) => {
      if (h?.zoom) graph.current?.zoomToFit(600, pad, (n) => h.nodes.has(String(n.id)));
      else if (!h) graph.current?.zoomToFit(0, 40);
    },
    [pad],
  );
  // Opening the side panel narrows the canvas, so the view is framed again for the new size.
  // force-graph applies a new width on a timer, so the fit waits a tick to frame against it.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => fit(highlight), 50);
    return () => clearTimeout(timer);
  }, [ready, highlight, fit, size.width, size.height]);

  const drawNode = useCallback(
    (node: Node, ctx: CanvasRenderingContext2D, scale: number) => {
      const style = nodeStyle(node, kinds);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = style.size;
      const lit = active?.nodes.has(node.id) ?? false;
      ctx.globalAlpha = active && !lit ? 0.15 : 1;
      ctx.fillStyle = colors[style.token];
      ctx.strokeStyle = colors[style.token];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (style.shape === "square") ctx.rect(x - r, y - r, r * 2, r * 2);
      else if (style.shape === "diamond") {
        ctx.moveTo(x, y - r * 1.2);
        ctx.lineTo(x + r * 1.2, y);
        ctx.lineTo(x, y + r * 1.2);
        ctx.lineTo(x - r * 1.2, y);
        ctx.closePath();
      } else ctx.arc(x, y, r, 0, 2 * Math.PI);
      if (style.shape === "ring") ctx.stroke();
      else ctx.fill();
      if (lit) {
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5, 0, 2 * Math.PI);
        ctx.strokeStyle = colors["--foreground"];
        ctx.lineWidth = 1.5 / scale;
        ctx.stroke();
      }
      if (node.id === hoverId || node.id === selectedId) {
        ctx.globalAlpha = 1;
        const name = node.type === "Excerpt" ? "Quote" : node.name;
        const label = name.length > 64 ? `${name.slice(0, 63)}...` : name;
        ctx.font = `${11 / scale}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = colors["--foreground"];
        ctx.fillText(label, x, y + r + 4);
      }
      ctx.globalAlpha = 1;
    },
    [colors, active, kinds, hoverId, selectedId],
  );

  const paintArea = useCallback(
    (node: Node, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, nodeStyle(node, kinds).size + 3, 0, 2 * Math.PI);
      ctx.fill();
    },
    [kinds],
  );

  const litLink = useCallback((link: Link) => active?.edges.has(edgeKey(endId(link.source), endId(link.target))) ?? false, [active]);
  const linkColor = useCallback(
    (link: Link) => (litLink(link) ? colors["--foreground"] : active ? colors["--border"] : colors["--muted-foreground"]),
    [colors, active, litLink],
  );

  return (
    <div ref={wrap} className="bg-surface h-96 w-full overflow-hidden rounded-xl lg:h-160">
      {ready && (
        <ForceGraph2D<GraphNode, GraphEdge>
          ref={graph}
          width={size.width}
          height={size.height}
          graphData={data}
          nodeLabel={() => ""}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintArea}
          linkLabel={(l) => l.type}
          linkColor={linkColor}
          linkWidth={(l) => (litLink(l) ? 2 : 1)}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={linkColor}
          autoPauseRedraw={false}
          warmupTicks={80}
          cooldownTicks={120}
          onEngineStop={() => {
            if (fitted.current) return;
            fitted.current = true;
            fit(highlight);
          }}
          onNodeClick={(n) => onNodeClick(String(n.id))}
          onNodeHover={(n) => setHoverId(n ? String(n.id) : null)}
        />
      )}
    </div>
  );
}
