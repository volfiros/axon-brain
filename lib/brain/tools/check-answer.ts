import { z } from "zod";
import { check, citationRows, citedTexts, quoteFound, SEVERITY } from "../citations";
import { defineTool } from "../tool";

export default defineTool({
  name: "check_answer",
  description:
    "Checks an answer before you give it: for each statement, whether every decision it cites is still current " +
    "(accepted, not superseded, source unchanged) and visible to the caller, and whether its quote is in a cited source. " +
    "Call it before a final answer that cites decisions.",
  inputSchema: z.object({
    statements: z
      .array(
        z.object({
          text: z.string().describe("One statement from your answer."),
          decision_ids: z.array(z.string()).max(10).describe("The decision ids the statement relies on."),
          quote: z.string().optional().describe("Words you quote from a source, checked word for word."),
        }),
      )
      .min(1)
      .max(20),
  }),
  readOnly: true,
  async handler({ statements }, ctx) {
    const ids = [...new Set(statements.flatMap((s) => s.decision_ids))];
    const [byId, texts] = await Promise.all([citationRows(ctx, ids), citedTexts(ctx, ids)]);

    const results = statements.map((statement, i) => {
      if (statement.decision_ids.length === 0) {
        return { ok: false, block: `${i + 1}. "${statement.text}": unsourced, it cites no decision.` };
      }
      const checks = statement.decision_ids.map((id) => check(id, byId.get(id)));
      const worst = SEVERITY.find((v) => checks.some((c) => c.verdict === v))!;
      const misquoted =
        statement.quote !== undefined && !quoteFound(statement.quote, statement.decision_ids.flatMap((id) => texts.get(id) ?? []));
      return {
        ok: worst === "current" && !misquoted,
        block: [
          `${i + 1}. "${statement.text}": ${worst}${misquoted ? ", quote not found" : ""}`,
          ...checks.map((c) => `   - ${c.line}`),
          ...(misquoted ? [`   - quote "${statement.quote}" is not in any source you can see behind the cited decisions`] : []),
        ].join("\n"),
      };
    });
    return [
      ...results.map((r) => r.block),
      results.every((r) => r.ok) ? "Every statement is backed by current decisions." : "Fix or drop the statements that are not current before answering.",
    ].join("\n");
  },
});

