import { z } from "zod";
import { checkCitations, narrowest, writeAnswer, type AnswerStatement } from "../answers";
import type { CitationRow } from "../citations";
import { requireWriter } from "../caller";
import { defineTool } from "../tool";

export default defineTool({
  name: "save_answer",
  description:
    "Saves an answer the user wants to keep, as statements that each cite the accepted decisions behind them. " +
    "The answer is marked stale when a cited decision is superseded or its source changes. " +
    "Call it first with confirm: false and show the preview to the user. Call it again with confirm: true only after the user agrees.",
  inputSchema: z.object({
    question: z.string().min(1).max(300).describe("The question the answer answers."),
    statements: z
      .array(
        z.object({
          text: z.string().min(1).max(500).describe("One statement of the answer."),
          decision_ids: z.array(z.string()).min(1).describe("Ids of the accepted decisions this statement rests on, from recall."),
        }),
      )
      .min(1)
      .max(10),
    confirm: z.boolean().default(false).describe("false returns a preview and writes nothing. true writes it."),
  }),
  readOnly: false,
  async handler(input, ctx) {
    requireWriter(ctx.caller);
    const cited = await checkCitations(ctx, input.statements);
    const preview = renderAnswer(input.question, input.statements, cited);
    if (!input.confirm) {
      return `${preview}\n\nNothing is saved yet. Show this to the user and call save_answer again with confirm: true once they agree.`;
    }
    const { id, again } = await writeAnswer(ctx, input.question, input.statements, [...cited.values()]);
    return `${again ? `Already saved as ${id}, nothing new written.` : `Saved answer ${id}.`}\n\n${preview}`;
  },
});

function renderAnswer(question: string, statements: AnswerStatement[], cited: Map<string, CitationRow>): string {
  const lines = [`Question: ${question}`];
  statements.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.text}`);
    lines.push(`   Cites: ${s.decision_ids.map((id) => `${cited.get(id)!.title} (${id})`).join("; ")}`);
  });
  lines.push(`Visible to: ${narrowest([...cited.values()]).sensitivity}, the narrowest of the cited decisions`);
  return lines.join("\n");
}
