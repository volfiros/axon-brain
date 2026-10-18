"use client";

import { ArrowRightIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import { DECISION_STATES, DecisionStatusBadge, type DecisionState } from "@/components/decision-status-badge";
import { Note, SheetField as Field, SourceLink } from "@/components/sheet-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { DecisionTrail, GraphNode, GraphView } from "@/lib/brain/graph-view";
import { cn } from "@/lib/utils";

import { decisionTrailAction } from "./actions";
import { edgeKey, legend, sourceKinds, type Highlight } from "./graph-style";

const GraphCanvas = dynamic(() => import("./graph-canvas"), {
  ssr: false,
  loading: () => <Skeleton className="h-96 w-full rounded-xl lg:h-160" />,
});

type Neighbor = { node: GraphNode; type: string; outgoing: boolean };

const RELATIONS: Record<string, [outgoing: string, incoming: string]> = {
  MADE_BY: ["Decided by", "Decided"],
  APPROVED_BY: ["Approved by", "Approved"],
  ABOUT: ["About", "Mentioned by"],
  AFFECTS: ["Affects", "Affected by"],
  BECAUSE_OF: ["Because of", "Reason for"],
  SUPERSEDES: ["Supersedes", "Superseded by"],
  IMPLEMENTED_BY: ["Implemented by", "Implements"],
  DERIVED_FROM: ["Quote", "Quoted by"],
  IN: ["In", "Contains"],
  AUTHORED: ["Authored", "Authored by"],
  PART_OF: ["Part of", "Contains"],
  OWNS: ["Owns", "Owned by"],
  WORKED_ON: ["Worked on", "Worked on by"],
  TOUCHES: ["Touches", "Touched by"],
};

function relation(n: Neighbor): string {
  const known = RELATIONS[n.type];
  if (known) return known[n.outgoing ? 0 : 1];
  const words = n.type.toLowerCase().replaceAll("_", " ");
  return n.outgoing ? words.charAt(0).toUpperCase() + words.slice(1) : `${words.charAt(0).toUpperCase() + words.slice(1)} from`;
}

function groupNeighbors(neighbors: Neighbor[]): [string, GraphNode[]][] {
  const groups = new Map<string, GraphNode[]>();
  for (const n of neighbors) {
    const label = relation(n);
    const list = groups.get(label) ?? [];
    if (!list.some((x) => x.id === n.node.id)) list.push(n.node);
    groups.set(label, list);
  }
  return [...groups.entries()];
}

export function GraphExplorer({ slug, view }: { slug: string; view: GraphView }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ id: string; trail: DecisionTrail | null } | null>(null);
  const requested = useRef<string | null>(null);
  const panel = useRef<HTMLElement>(null);

  const byId = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view.nodes]);
  const kinds = useMemo(() => sourceKinds(view.nodes), [view.nodes]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const result = loaded && loaded.id === selectedId ? loaded : null;
  const trail = result?.trail ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return view.nodes.filter((n) => n.type === "Decision" && n.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, view.nodes]);

  const neighbors = useMemo<Neighbor[]>(() => {
    if (!selectedId) return [];
    return view.edges.flatMap((e) => {
      const outgoing = e.source === selectedId;
      const other = byId.get(outgoing ? e.target : e.source);
      return (outgoing || e.target === selectedId) && other ? [{ node: other, type: e.type, outgoing }] : [];
    });
  }, [selectedId, view.edges, byId]);

  const highlight = useMemo<Highlight | null>(() => {
    if (!selectedId) return null;
    if (trail?.id === selectedId) {
      return { nodes: new Set(trail.pathNodes), edges: new Set(trail.pathEdges.map((e) => edgeKey(e.source, e.target))), zoom: true };
    }
    return {
      nodes: new Set([selectedId, ...neighbors.map((n) => n.node.id)]),
      edges: new Set(neighbors.map((n) => (n.outgoing ? edgeKey(selectedId, n.node.id) : edgeKey(n.node.id, selectedId)))),
      zoom: false,
    };
  }, [selectedId, trail, neighbors]);

  useEffect(() => {
    if (selectedId && window.matchMedia("(max-width: 1023px)").matches) {
      panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedId]);

  function select(id: string | null) {
    setSelectedId(id);
    requested.current = id;
    const node = id ? byId.get(id) : undefined;
    if (node?.type !== "Decision") return;
    // A slower answer for an earlier click must not replace the one for the current selection.
    decisionTrailAction(slug, node.id).then(
      (found) => requested.current === node.id && setLoaded({ id: node.id, trail: found }),
      () => requested.current === node.id && setLoaded({ id: node.id, trail: null }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Input
          variant="field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
            if (e.key === "Enter" && matches[0]) {
              setQuery("");
              select(matches[0].id);
            }
          }}
          placeholder="Search decisions by title"
          aria-label="Search decisions by title"
        />
        {matches.length > 0 && (
          <ul className="bg-popover text-popover-foreground absolute inset-x-0 top-full z-10 mt-1 flex flex-col rounded-lg border p-1 shadow-md">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="hover:bg-surface-hover flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm font-light"
                  onClick={() => {
                    setQuery("");
                    select(m.id);
                  }}
                >
                  <span className="min-w-0 truncate">{m.name}</span>
                  {isState(m.status) && <DecisionStatusBadge status={m.status} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <GraphCanvas nodes={view.nodes} edges={view.edges} kinds={kinds} highlight={highlight} selectedId={selectedId} onNodeClick={select} />
          <Legend view={view} kinds={kinds} />
        </div>
        {selected && (
          <aside ref={panel} className="flex scroll-mt-28 flex-col gap-3 lg:w-96">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  {selected.type === "Decision" && isState(selected.status) ? (
                    <DecisionStatusBadge status={selected.status} />
                  ) : (
                    <Badge variant="muted">{selected.kind && selected.type === "Source" ? selected.kind : selected.type}</Badge>
                  )}
                </div>
                <h2 className="text-lg font-light">{selected.name}</h2>
              </div>
              <Button variant="ghost" size="icon" shape="pill" aria-label="Close" onClick={() => select(null)}>
                <XIcon />
              </Button>
            </div>
            {selected.type === "Decision" ? (
              !result ? (
                <Skeleton className="h-40 w-full rounded-xl" />
              ) : trail ? (
                <DecisionFields trail={trail} />
              ) : (
                <Note>This decision is not available.</Note>
              )
            ) : (
              <NodeFields node={selected} />
            )}
            <Field label="Neighbors">
              {neighbors.length === 0 && <Note>None you can see</Note>}
              {groupNeighbors(neighbors).map(([label, group]) => (
                <div key={label} className="flex flex-col gap-1">
                  <span className="text-secondary-foreground text-xs font-light">{label}</span>
                  <ul className="flex flex-col">
                    {group.map((node) => (
                      <li key={node.id}>
                        <button
                          type="button"
                          className="hover:bg-surface-hover -mx-2 w-full rounded-md px-2 py-1 text-left"
                          onClick={() => select(node.id)}
                        >
                          <span className="line-clamp-2">{node.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Field>
          </aside>
        )}
      </div>
    </div>
  );
}

function isState(status: string | null): status is DecisionState {
  return DECISION_STATES.includes(status as DecisionState);
}

function DecisionFields({ trail }: { trail: DecisionTrail }) {
  return (
    <>
      <p className="text-secondary-foreground text-sm font-light">{trail.statement}</p>
      {trail.paths.length > 0 && (
        <Field label="Graph path">
          {trail.paths.map((path) => (
            <ol key={path.map((hop) => hop.id).join(">")} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              {path.map((hop, i) => (
                <li key={hop.id} className="flex min-w-0 items-center gap-1.5">
                  {i > 0 && <ArrowRightIcon className="text-secondary-foreground size-3 shrink-0" />}
                  <span className="max-w-48 truncate">{hop.name}</span>
                </li>
              ))}
            </ol>
          ))}
        </Field>
      )}
      <Field label="Because">
        <List items={trail.because} empty="No reason you can see" />
        {trail.hiddenReasons && <Note>{trail.hiddenReasons}</Note>}
      </Field>
      <Field label="Rejected alternatives">
        <List items={trail.rejected} empty="No alternatives recorded" />
      </Field>
      <Field label="Decided by">
        <span>{trail.decidedBy}</span>
      </Field>
      <Field label="Source">
        {trail.sources.length === 0 && <Note>None you can see</Note>}
        {trail.sources.map((s) => (
          <div key={`${s.title}-${s.quote}`} className="flex flex-col gap-1">
            <q className="font-light">{s.quote}</q>
            <span className="text-secondary-foreground">
              <SourceLink href={s.url}>{s.title}</SourceLink>
            </span>
          </div>
        ))}
        {trail.hiddenSources && <Note>{trail.hiddenSources}</Note>}
      </Field>
    </>
  );
}

function NodeFields({ node }: { node: GraphNode }) {
  if (!node.text && !node.url) return null;
  return (
    <Field label="Details">
      {node.text && node.text !== node.name && <span className="font-light">{node.text}</span>}
      {node.url && (
        <span className="text-secondary-foreground">
          <SourceLink href={node.url}>Open source</SourceLink>
        </span>
      )}
    </Field>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <Note>{empty}</Note>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Legend({ view, kinds }: { view: GraphView; kinds: string[] }) {
  return (
    <ul className="text-secondary-foreground flex flex-wrap gap-x-4 gap-y-2 text-xs font-light">
      {legend(view.nodes, kinds).map((style) => (
        <li key={style.label} className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-2.5 shrink-0",
              style.swatch,
              style.shape === "square" && "rounded-sm",
              style.shape === "diamond" && "size-2 rotate-45",
              (style.shape === "circle" || style.shape === "ring") && "rounded-full",
            )}
          />
          {style.label}
        </li>
      ))}
    </ul>
  );
}
