import { FROM_CALLER, readAsCaller, visible } from "./access";
import { sourceChanged } from "./source-changes";
import type { BrainContext } from "./tool";
import type { Sensitivity } from "./write";

export const SEVERITY = ["not_found_or_not_visible", "superseded", "flagged", "not_accepted", "current"] as const;
export type Verdict = (typeof SEVERITY)[number];

export type CitationRow = {
  id: string;
  title: string;
  status: string;
  sensitivity: Sensitivity | null;
  replacedBy: { id: string; title: string }[];
  changedSources: number;
};

/** Cited decisions the caller can see, with their visible superseders and how many visible Sources changed since recording. */
export async function citationRows(ctx: BrainContext, ids: string[]): Promise<Map<string, CitationRow>> {
  const rows = await readAsCaller<CitationRow>(
    ctx,
    `${FROM_CALLER}
     MATCH (d:Decision) WHERE d.id IN $ids AND ${visible("d")}
     OPTIONAL MATCH (n:Decision)-[:SUPERSEDES]->(d) WHERE n.status IN ['accepted', 'superseded'] AND ${visible("n")}
     OPTIONAL MATCH (d)-[link:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source) WHERE ${visible("s")} AND ${sourceChanged("link", "s")}
     RETURN d.id AS id, d.title AS title, d.status AS status, d.sensitivity AS sensitivity,
            [x IN collect(DISTINCT {id: n.id, title: n.title}) WHERE x.id IS NOT NULL] AS replacedBy,
            count(DISTINCT s) AS changedSources`,
    { ids },
  );
  return new Map(rows.map((r) => [r.id, r]));
}

export async function citedTexts(ctx: BrainContext, ids: string[]): Promise<Map<string, string[]>> {
  const rows = await readAsCaller<{ id: string; texts: string[] }>(
    ctx,
    `${FROM_CALLER}
     MATCH (d:Decision)-[:DERIVED_FROM]->(ex:Excerpt)-[:IN]->(s:Source)
     WHERE d.id IN $ids AND ${visible("d")} AND ${visible("s")}
     RETURN d.id AS id, collect(DISTINCT ex.text) + collect(DISTINCT s.text) AS texts`,
    { ids },
  );
  return new Map(rows.map((r) => [r.id, r.texts]));
}

const normalize = (text: string) => text.toLowerCase().replace(/[“”"‘’']/g, "").replace(/\s+/g, " ").trim();

// Case, spacing and quote marks differ between what agents quote and what tools store.
export function quoteFound(quote: string, texts: string[]): boolean {
  const wanted = normalize(quote);
  return wanted.length > 0 && texts.some((t) => normalize(t).includes(wanted));
}

/** An accepted decision with a visible superseder counts as superseded. */
export function check(id: string, row: CitationRow | undefined): { verdict: Verdict; line: string } {
  if (!row) return { verdict: "not_found_or_not_visible", line: `${id}: not_found_or_not_visible` };
  const name = `${id} "${row.title}"`;
  if (row.status === "superseded" || row.replacedBy.length > 0) {
    const by = row.replacedBy.map((r) => `${r.id} "${r.title}"`).join(", ");
    return { verdict: "superseded", line: `${name}: superseded, replaced_by ${by || "none you can see"}` };
  }
  if (row.status !== "accepted") return { verdict: "not_accepted", line: `${name}: not_accepted, its status is ${row.status}` };
  if (row.changedSources > 0) {
    return { verdict: "flagged", line: `${name}: flagged, its source changed since it was recorded (see review_source_changes)` };
  }
  return { verdict: "current", line: `${name}: current` };
}
