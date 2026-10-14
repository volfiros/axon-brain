import { z } from "zod";
import { FROM_CALLER, readAsCaller, visible } from "../access";
import { requireWriter } from "../caller";
import { defineTool } from "../tool";
import { itemFields, resolveItem, writeItem, type Sensitivity } from "../write";

const proposal = z
  .object(itemFields)
  .pick({ statement: true, excerpt: true, because_ids: true, new_constraints: true, new_assumptions: true, rejected: true, affects: true, about: true })
  .extend({ title: z.string().describe("Short name for the decision.") });

type Source = {
  title: string;
  text: string | null;
  extraction: string | null;
  contentHash: string | null;
  sensitivity: Sensitivity;
  authors: string[];
};

// Agents often re-wrap lines when quoting, so excerpts are compared with whitespace collapsed.
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export default defineTool({
  name: "propose_from_source",
  description:
    "Records the decisions found in one pending Source as proposed, each with an excerpt copied word for word from the Source text, then marks the Source done. " +
    "Send an empty items list when the Source holds no decision. Check recall first and leave out decisions that are already saved. " +
    "Proposed decisions wait for a person to accept or dismiss them with review_proposals.",
  inputSchema: z.object({
    source_id: z.string(),
    content_hash: z.string().describe("The content_hash pending_sources returned for this Source."),
    items: z.array(proposal).max(10).default([]),
  }),
  readOnly: false,
  async handler({ source_id, content_hash, items }, ctx) {
    requireWriter(ctx.caller);
    const [source] = await readAsCaller<Source>(
      ctx,
      `${FROM_CALLER}
       MATCH (s:Source {id: $id}) WHERE s.deleted_at IS NULL AND ${visible("s")}
       OPTIONAL MATCH (a:Person)-[:AUTHORED]->(s)
       RETURN s.title AS title, s.text AS text, s.extraction AS extraction, s.content_hash AS contentHash,
              s.sensitivity AS sensitivity, collect(a.id) AS authors`,
      { id: source_id },
    );
    if (!source) throw new Error(`No Source you can see has the id ${source_id}.`);
    if (source.extraction !== "pending") throw new Error(`Source ${source_id} is already ${source.extraction ?? "not queued"}, so nothing was written.`);
    if (source.contentHash !== content_hash) {
      throw new Error(`Source ${source_id} changed since you read it. Read it again with pending_sources. Nothing was written.`);
    }

    const text = normalize(source.text ?? "");
    const misquoted = items.filter((item) => !text.includes(normalize(item.excerpt)));
    if (misquoted.length > 0) {
      throw new Error(
        `These excerpts are not word for word in the Source text, so nothing was written: ${misquoted.map((i) => `"${i.title}"`).join(", ")}. Copy the excerpt exactly and try again.`,
      );
    }

    const plans = [];
    for (const item of items) {
      plans.push(await resolveItem(ctx, { ...item, kind: "decision", source_title: source.title }, source.sensitivity ?? "team"));
    }
    const madeBy = source.authors.length === 1 ? source.authors[0] : null;
    const written = [];
    for (const plan of plans) {
      const { itemId } = await writeItem(ctx, plan, { id: source_id }, { status: "proposed", madeBy, sourceHash: content_hash });
      written.push({ id: itemId, plan });
    }
    await ctx.graph.query(
      `MATCH (s:Source {id: $id}) WHERE s.content_hash = $hash
       SET s.extraction = 'done', s.extracted_at = localdatetime(), s.extracted_by = $personId`,
      { id: source_id, hash: content_hash, personId: ctx.caller.personId },
    );

    if (written.length === 0) return `No decisions recorded. Source ${source_id} is marked done.`;
    const lines = [`Proposed ${written.length} decision${written.length === 1 ? "" : "s"} from "${source.title}". Source ${source_id} is marked done.`];
    for (const { id, plan } of written) {
      lines.push(`- ${plan.input.title} (${id}, proposed)`);
      if (plan.unmatched.length) lines.push(`  Not found in the graph, skipped: ${plan.unmatched.join(", ")}`);
      if (plan.similar.length) lines.push(`  Similar saved decisions: ${plan.similar.map((s) => `${s.title} (${s.id})`).join("; ")}`);
    }
    lines.push("Ask the user to review them with review_proposals.");
    return lines.join("\n");
  },
});
