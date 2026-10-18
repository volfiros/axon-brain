import { z } from "zod";
import { STALE_AFTER, staleDecisions } from "../stale";
import { defineTool } from "../tool";

export default defineTool({
  name: "stale_decisions",
  description:
    `Accepted decisions whose code has had ${STALE_AFTER}+ PRs or commits since they were made, with the changes and the code owners.`,
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).default(10),
  }),
  readOnly: true,
  async handler({ limit }, ctx) {
    const stale = await staleDecisions(ctx);
    if (stale.length === 0) return "No decision you can see is stale.";
    return [
      `${Math.min(limit, stale.length)} of ${stale.length} stale decisions:`,
      ...stale.slice(0, limit).map((d) =>
        [
          `- ${d.title} (${d.id}), made ${d.made}, ${d.changes.length} changes since:`,
          ...d.changes.slice(0, 5).map((c) => `  - ${c.date} ${c.title} (${c.url ?? c.id}) touched ${c.paths.join(", ")}`),
          ...(d.changes.length > 5 ? [`  - and ${d.changes.length - 5} more`] : []),
          `  Owners: ${d.owners.join(", ") || "none recorded"}`,
        ].join("\n"),
      ),
    ].join("\n");
  },
});
