import { z } from "zod";
import { check, citationRows, SEVERITY } from "../citations";
import { defineTool } from "../tool";

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
    const byId = await citationRows(ctx, ids);

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

