import { z } from "zod";
import { rankPeople } from "../people";
import { defineTool } from "../tool";

export default defineTool({
  name: "who_knows",
  description:
    "Ranks the people who know most about a topic, file or process, from what they own, the decisions they made or approved, the sources they wrote and how often they changed it.",
  inputSchema: z.object({
    topic: z.string().describe("A topic, file path or process, for example 'payment webhooks' or 'src/billing/refunds.ts'."),
  }),
  readOnly: true,
  async handler({ topic }, ctx) {
    const ranked = await rankPeople(ctx, topic);
    if (ranked === null) return "Name a topic, file or process to rank people for.";
    if (ranked.length === 0) return `No one in this workspace is linked to "${topic}" yet.`;

    return [
      `People who know about "${topic}":`,
      ...ranked.map(
        (p, i) =>
          `${i + 1}. ${p.name}${p.title ? `, ${p.title}` : ""}${p.onAxon ? "" : " (not on Axon)"}: score ${p.score}. ${p.reasons.join("; ")}`,
      ),
    ].join("\n");
  },
});
