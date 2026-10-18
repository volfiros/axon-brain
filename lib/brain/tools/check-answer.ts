import { z } from "zod";
import { FROM_CALLER, readAsCaller, visible } from "../access";
import { sourceChanged } from "../source-changes";
import { defineTool } from "../tool";

const SEVERITY = ["not_found_or_not_visible", "superseded", "flagged", "not_accepted", "current"] as const;
type Verdict = (typeof SEVERITY)[number];

type Row = { id: string; title: string; status: string; replacedBy: { id: string; title: string }[]; changedSources: number };

export default defineTool({
  name: "check_answer",
  description:
    "Checks an answer before you give it: for each statement, whether every decision it cites is still current " +
    "(accepted, not superseded, source unchanged) and visible to the caller. Call it before a final answer that cites decisions.",
  inputSchema: z.object({
    statements: z
      .array(
        z.object({
          text: z.string().describe("One statement from your answer."),
          decision_ids: z.array(z.string()).max(10).describe("The decision ids the statement relies on."),
        }),
      )
      .min(1)
      .max(20),
  }),
  readOnly: true,
  async handler({ statements }, ctx) {
    const ids = [...new Set(statements.flatMap((s) => s.decision_ids))];
    const rows = await readAsCaller<Row>(
      ctx,
      `${FROM_CALLER}
       MATCH (d:Decision) WHERE d.id IN $ids AND ${visible("d")}
       OPTIONAL MATCH (n:Decision)-[:SUPERSEDES]->(d) WHERE n.status IN ['accepted', 'superseded'] AND ${visible("n")}
       OPTIONAL MATCH (d)-[link:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source) WHERE ${visible("s")} AND ${sourceChanged("link", "s")}
       RETURN d.id AS id, d.title AS title, d.status AS status,
              [x IN collect(DISTINCT {id: n.id, title: n.title}) WHERE x.id IS NOT NULL] AS replacedBy,
              count(DISTINCT s) AS changedSources`,
      { ids },
    );
    const byId = new Map(rows.map((r) => [r.id, r]));

    const results = statements.map((statement, i) => {
      if (statement.decision_ids.length === 0) {
        return { ok: false, block: `${i + 1}. "${statement.text}": unsourced, it cites no decision.` };
      }
      const checks = statement.decision_ids.map((id) => check(id, byId.get(id)));
      const worst = SEVERITY.find((v) => checks.some((c) => c.verdict === v))!;
      return {
        ok: worst === "current",
        block: [`${i + 1}. "${statement.text}": ${worst}`, ...checks.map((c) => `   - ${c.line}`)].join("\n"),
      };
    });
    return [
      ...results.map((r) => r.block),
      results.every((r) => r.ok) ? "Every statement is backed by current decisions." : "Fix or drop the statements that are not current before answering.",
    ].join("\n");
  },
});

function check(id: string, row: Row | undefined): { verdict: Verdict; line: string } {
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
