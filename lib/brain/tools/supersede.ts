import { z } from "zod";
import { FROM_CALLER, readAsCaller, visible } from "../access";
import { requireWriter } from "../caller";
import { defineTool } from "../tool";
import { itemFields, renderPlan, resolveItem, supersedeDecision, writeItem, type Sensitivity } from "../write";

export default defineTool({
  name: "supersede",
  description:
    "Replaces an existing decision with a new one. The old decision is kept as history, marked superseded, and linked from the new one. Nothing is deleted. " +
    "Call it first with confirm: false and show the preview to the user. Call it again with confirm: true only after the user agrees.",
  inputSchema: z
    .object(itemFields)
    .omit({ kind: true })
    .extend({
      old_id: z.string().describe("Id of the decision being replaced."),
      confirm: z.boolean().default(false).describe("false returns a preview and writes nothing. true writes it."),
    }),
  readOnly: false,
  async handler(input, ctx) {
    requireWriter(ctx.caller);
    const [old] = await readAsCaller<{ title: string; status: string; sensitivity: Sensitivity }>(
      ctx,
      `${FROM_CALLER}
       MATCH (d:Decision {id: $id}) WHERE ${visible("d")}
       RETURN d.title AS title, d.status AS status, d.sensitivity AS sensitivity`,
      { id: input.old_id },
    );
    if (!old) throw new Error(`No decision you can see has the id ${input.old_id}.`);
    if (old.status === "superseded") throw new Error(`"${old.title}" is already superseded. Supersede the decision that replaced it.`);
    if (old.status === "dismissed") throw new Error(`"${old.title}" was dismissed, so there is nothing to replace.`);

    const plan = await resolveItem(ctx, { ...input, kind: "decision" }, old.sensitivity);
    plan.similar = plan.similar.filter((s) => s.id !== input.old_id);
    const preview = `Replaces: ${old.title} (${input.old_id}, ${old.status})\n${renderPlan(plan)}`;
    if (!input.confirm) {
      return `${preview}\n\nNothing is saved yet. Show this to the user and call supersede again with confirm: true once they agree.`;
    }
    const { itemId } = await writeItem(ctx, plan, { title: input.source_title, url: input.source_url });
    await supersedeDecision(ctx, itemId, input.old_id);
    return `Saved ${itemId} as accepted. "${old.title}" is now superseded and kept as history.\n\n${preview}`;
  },
});
