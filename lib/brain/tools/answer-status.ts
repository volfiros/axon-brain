import { z } from "zod";
import { listAnswers } from "../answers";
import { defineTool } from "../tool";

export default defineTool({
  name: "answer_status",
  description:
    "Lists saved answers you can see, stale ones first. A stale answer says which cited decision was superseded or had its source changed, " +
    "and the decision that replaced it.",
  inputSchema: z.object({
    stale_only: z.boolean().default(false).describe("true lists only stale answers."),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  readOnly: true,
  async handler({ stale_only, limit }, ctx) {
    const answers = await listAnswers(ctx, stale_only, limit);
    if (answers.length === 0) return stale_only ? "No saved answer you can see is stale." : "No saved answers you can see.";
    return answers
      .map((a) => {
        const lines = [`- ${a.question} (${a.id}, ${a.status}), saved by ${a.savedBy ?? "unknown"} on ${a.savedAt}`];
        a.statements.forEach((s, i) => {
          lines.push(`  ${i + 1}. ${s.text}`);
          lines.push(`     Cites: ${s.cites.map((c) => `${c.title} (${c.id}, ${c.status})`).join("; ")}`);
        });
        if (a.status === "stale") {
          lines.push(`  Stale since ${a.staleAt}: ${a.staleReason}.`);
          if (a.replacedBy) lines.push(`  Replaced by: ${a.replacedBy.title} (${a.replacedBy.id})`);
        }
        return lines.join("\n");
      })
      .join("\n");
  },
});
