import { z } from "zod";
import { requireWriter } from "../caller";
import { defineTool } from "../tool";
import { itemFields, renderPlan, resolveItem, writeItem } from "../write";

export default defineTool({
  name: "save",
  description:
    "Saves a decision, constraint, assumption or context note the user stated, with its reason, rejected alternatives, what it affects and the exact quote. " +
    "Call it first with confirm: false and show the preview to the user. Call it again with confirm: true only after the user agrees.",
  inputSchema: z.object({
    ...itemFields,
    confirm: z.boolean().default(false).describe("false returns a preview and writes nothing. true writes it."),
  }),
  readOnly: false,
  async handler(input, ctx) {
    requireWriter(ctx.caller);
    const plan = await resolveItem(ctx, input);
    if (!input.confirm) {
      return `${renderPlan(plan)}\n\nNothing is saved yet. Show this to the user and call save again with confirm: true once they agree.`;
    }
    const { itemId } = await writeItem(ctx, plan, { title: input.source_title, url: input.source_url });
    return `Saved ${input.kind} ${itemId}${input.kind === "decision" ? " as accepted" : ""}, confirmed by ${ctx.caller.name}.\n\n${renderPlan(plan)}`;
  },
});
