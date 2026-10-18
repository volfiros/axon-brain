import { randomUUID } from "node:crypto";

import type { AxonGraph } from "@/lib/graph/client";

import { FROM_CALLER, readAsCaller, visible } from "./access";
import { day } from "./search";
import { sourceChanged } from "./source-changes";
import { check, citationRows, type CitationRow } from "./citations";
import type { BrainContext } from "./tool";
import type { Sensitivity } from "./write";

export type AnswerStatement = { text: string; decision_ids: string[] };

export type AnswerView = {
  id: string;
  question: string;
  status: "current" | "stale";
  savedBy: string | null;
  savedAt: string;
  staleReason: string | null;
  staleAt: string | null;
  replacedBy: { id: string; title: string } | null;
  statements: { text: string; cites: { id: string; title: string; status: string }[] }[];
};

const NARROWEST: Sensitivity[] = ["restricted", "team", "public"];

/** Throws with every cited decision that is not current, using check_answer's verdicts; returns the cited decisions by id otherwise. */
export async function checkCitations(ctx: BrainContext, statements: AnswerStatement[]): Promise<Map<string, CitationRow>> {
  const ids = [...new Set(statements.flatMap((s) => s.decision_ids))];
  const cited = await citationRows(ctx, ids);
  const problems = ids.map((id) => check(id, cited.get(id))).filter((c) => c.verdict !== "current");
  if (problems.length) {
    throw new Error(
      [...problems.map((c) => c.line), "Cite only current decisions. Check a flagged one with review_source_changes first."].join("\n"),
    );
  }
  return cited;
}

/** The narrowest audience among the cited decisions, and the decision whose VISIBLE_TO edges the answer copies. */
export function narrowest(cited: CitationRow[]): { sensitivity: Sensitivity; from: string } {
  const sorted = [...cited].sort(
    (a, b) => NARROWEST.indexOf(a.sensitivity ?? "team") - NARROWEST.indexOf(b.sensitivity ?? "team"),
  );
  return { sensitivity: sorted[0].sensitivity ?? "team", from: sorted[0].id };
}

/** Writes an Answer through application code, or returns the caller's current Answer with the same question and statements. */
export async function writeAnswer(
  ctx: BrainContext,
  question: string,
  statements: AnswerStatement[],
  cited: CitationRow[],
): Promise<{ id: string; again: boolean }> {
  const texts = statements.map((s) => s.text);
  const cites = statements.flatMap((s, statement) => s.decision_ids.map((decisionId) => ({ statement, decisionId })));
  const citeKey = [...new Set(cites.map((c) => `${c.statement}:${c.decisionId}`))].sort().join(",");
  const params = { personId: ctx.caller.personId, question, statements: texts, citeKey };
  const [existing] = await ctx.graph.roQuery<{ id: string }>(
    `MATCH (:Person {id: $personId})-[:SAVED]->(a:Answer {status: 'current'})
     WHERE a.question = $question AND a.statements = $statements AND a.cite_key = $citeKey
     RETURN a.id AS id LIMIT 1`,
    params,
  );
  if (existing) return { id: existing.id, again: true };

  const id = `ans_${randomUUID().slice(0, 8)}`;
  const { sensitivity, from } = narrowest(cited);
  // One query, so an Answer never exists without its audience: it takes the VISIBLE_TO edges of its narrowest cited
  // decision and never reaches someone who cannot see what it cites.
  await ctx.graph.query(
    `MATCH (p:Person {id: $personId}), (src:Decision {id: $from})
     CREATE (p)-[:SAVED]->(a:Answer {id: $id, question: $question, statements: $statements, cite_key: $citeKey,
             status: 'current', sensitivity: $sensitivity, saved_by: $personId, saved_at: localdatetime()})
     WITH a, src
     MATCH (src)-[:VISIBLE_TO]->(g)
     CREATE (a)-[:VISIBLE_TO]->(g)
     WITH DISTINCT a
     UNWIND $cites AS c
     MATCH (d:Decision {id: c.decisionId})
     CREATE (a)-[:CITES {statement: c.statement}]->(d)`,
    { ...params, id, sensitivity, from, cites },
  );
  return { id, again: false };
}

/** Marks current Answers that cite `oldId` as stale once it is superseded. */
export async function markStaleOnSupersede(graph: AxonGraph, oldId: string): Promise<void> {
  await graph.query(
    `MATCH (a:Answer {status: 'current'})-[:CITES]->(d:Decision {id: $oldId})
     WITH DISTINCT a, d
     SET a.status = 'stale', a.stale_at = localdatetime(), a.stale_decision_id = d.id,
         a.stale_reason = '"' + d.title + '" was superseded'`,
    { oldId },
  );
}

/** Marks current Answers stale when a Source behind a cited decision was edited or deleted since the decision recorded it. */
export async function markStaleOnSourceChange(graph: AxonGraph, sourceIds: string[]): Promise<void> {
  if (sourceIds.length === 0) return;
  await graph.query(
    `MATCH (a:Answer {status: 'current'})-[:CITES]->(d:Decision)-[r:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)
     WHERE s.id IN $sourceIds AND ${sourceChanged("r", "s")}
     WITH a, head(collect(d)) AS d, head(collect(s)) AS s
     SET a.status = 'stale', a.stale_at = localdatetime(), a.stale_decision_id = d.id,
         a.stale_reason = 'A source of "' + d.title + '" was ' + CASE WHEN s.deleted_at IS NULL THEN 'edited' ELSE 'deleted' END`,
    { sourceIds },
  );
}

/**
 * Saved Answers the caller can see, stale first. An Answer shows only when the caller can see it and every decision it cites.
 * The replacing decision of a stale Answer is shown only when it is visible too.
 */
export async function listAnswers(ctx: BrainContext, staleOnly = false, limit = 100): Promise<AnswerView[]> {
  const rows = await readAsCaller<{
    id: string;
    question: string;
    statements: string[];
    status: "current" | "stale";
    savedBy: string | null;
    savedAt: unknown;
    staleReason: string | null;
    staleAt: unknown;
    replacedId: string | null;
    replacedTitle: string | null;
    cites: { statement: number; id: string; title: string; status: string }[];
  }>(
    ctx,
    `${FROM_CALLER}
     MATCH (a:Answer) WHERE ${visible("a")} AND ($staleOnly = false OR a.status = 'stale')
     OPTIONAL MATCH (a)-[:CITES]->(h:Decision) WHERE NOT ${visible("h")}
     WITH u, role, a, count(h) AS hidden
     WHERE hidden = 0
     OPTIONAL MATCH (n:Decision)-[:SUPERSEDES]->(old:Decision)
     WHERE old.id = a.stale_decision_id AND n.status IN ['accepted', 'superseded'] AND ${visible("n")}
     WITH u, role, a, head(collect(n)) AS n
     MATCH (a)-[c:CITES]->(d:Decision)
     OPTIONAL MATCH (saver:Person)-[:SAVED]->(a)
     WITH a, n, saver, collect({statement: c.statement, id: d.id, title: d.title, status: d.status}) AS cites
     RETURN a.id AS id, a.question AS question, a.statements AS statements, a.status AS status,
            saver.name AS savedBy, a.saved_at AS savedAt, a.stale_reason AS staleReason, a.stale_at AS staleAt,
            n.id AS replacedId, n.title AS replacedTitle, cites
     ORDER BY CASE a.status WHEN 'stale' THEN 0 ELSE 1 END, coalesce(a.stale_at, a.saved_at) DESC, a.id
     LIMIT $limit`,
    { staleOnly, limit },
  );
  return rows.map((r) => ({
    id: r.id,
    question: r.question,
    status: r.status,
    savedBy: r.savedBy,
    savedAt: day(r.savedAt),
    staleReason: r.staleReason,
    staleAt: r.staleAt == null ? null : day(r.staleAt),
    replacedBy: r.replacedId ? { id: r.replacedId, title: r.replacedTitle ?? r.replacedId } : null,
    statements: r.statements.map((text, i) => ({
      text,
      cites: r.cites.filter((c) => c.statement === i).map(({ id, title, status }) => ({ id, title, status })),
    })),
  }));
}
