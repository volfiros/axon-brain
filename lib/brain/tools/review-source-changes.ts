import { z } from "zod";
import { FROM_CALLER, readAsCaller, visible } from "../access";
import { requireWriter } from "../caller";
import { possibleConflicts } from "../conflicts";
import { confirmStillHolds, sourceChanged } from "../source-changes";
import { defineTool, type BrainContext } from "../tool";
import { decisionDetails, sourceChangeLine } from "./recall";

export default defineTool({
  name: "review_source_changes",
  description:
    "Lists accepted decisions whose source was edited or deleted after the decision was recorded, and possible conflicts between " +
    "accepted decisions on the same thing, or confirms that some still hold. " +
    "Only confirm after the user says the decision still holds. If it no longer holds, use supersede instead.",
  inputSchema: z.object({
    action: z.enum(["list", "still_holds"]),
    ids: z.array(z.string()).default([]).describe("Decision ids that still hold."),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  readOnly: false,
  async handler(input, ctx) {
    if (input.action === "list") return list(ctx, input.limit);
    requireWriter(ctx.caller);
    if (input.ids.length === 0) throw new Error("Give the ids of the decisions that still hold.");
    const confirmed = await confirmStillHolds(ctx, input.ids);
    const missed = input.ids.filter((id) => !confirmed.some((c) => c.id === id));
    return [
      confirmed.length
        ? `Confirmed by ${ctx.caller.name} as still holding: ${confirmed.map((c) => `${c.title} (${c.id})`).join("; ")}`
        : "Nothing was confirmed.",
      missed.length ? `Not found among accepted decisions you can see with a changed source: ${missed.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  },
});

async function list(ctx: BrainContext, limit: number): Promise<string> {
  const [changed, conflicts] = await Promise.all([changedSources(ctx, limit), possibleConflicts(ctx)]);
  if (conflicts.length === 0) return changed;
  return [
    changed,
    `${Math.min(limit, conflicts.length)} of ${conflicts.length} possible conflicts, accepted decisions on the same thing. ` +
      "Read both and tell the user if they disagree. Only a person settles it, with supersede or save_session.",
    ...conflicts.slice(0, limit).map((c) => {
      const [a, b] = c.decisions;
      const likely = c.decisions.find((d) => d.id === c.likely?.id);
      return [
        `- Both on ${c.targets.join(", ")}:`,
        `  ${a.title} (${a.id}, from ${a.source}): ${a.statement}`,
        `  ${b.title} (${b.id}, from ${b.source}): ${b.statement}`,
        likely
          ? `  If they disagree, ${likely.title} (${likely.id}) is more likely to hold: ${c.likely?.reason === "source" ? "it comes from a stronger source" : "same source rank, and it is newer"}.`
          : "  Neither is more likely to hold: same source rank and date.",
      ].join("\n");
    }),
  ].join("\n");
}

async function changedSources(ctx: BrainContext, limit: number): Promise<string> {
  const rows = await readAsCaller<{ id: string }>(
    ctx,
    `${FROM_CALLER}
     MATCH (d:Decision {status: 'accepted'})-[link:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)
     WHERE ${visible("d")} AND ${visible("s")} AND ${sourceChanged("link", "s")}
     RETURN DISTINCT d.id AS id, d.title AS title
     ORDER BY title`,
  );
  if (rows.length === 0) return "No accepted decision you can see has a source that changed.";
  const details = await decisionDetails(ctx, rows.slice(0, limit).map((r) => r.id));
  const blocks = [`${Math.min(limit, rows.length)} of ${rows.length} decisions need review:`];
  for (const { id } of rows.slice(0, limit)) {
    const d = details.get(id);
    if (!d) continue;
    blocks.push([`- ${d.title} (${d.id})`, `  ${d.statement}`, ...d.sourceChanges.map((c) => `  ${sourceChangeLine(c)}`)].join("\n"));
  }
  return blocks.join("\n");
}
