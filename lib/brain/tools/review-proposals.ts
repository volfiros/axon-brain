import { z } from "zod";
import { FROM_CALLER, readAsCaller, visible } from "../access";
import { requireWriter } from "../caller";
import { day } from "../search";
import { defineTool, type BrainContext } from "../tool";

type Proposal = {
  id: string;
  title: string;
  statement: string;
  maker: string | null;
  recordedAt: unknown;
  quote: string | null;
  sourceTitle: string | null;
  url: string | null;
  stale: boolean | null;
};

export default defineTool({
  name: "review_proposals",
  description:
    "Lists proposed decisions waiting for review, or accepts or dismisses them. Only accept or dismiss after the user says so. " +
    "Dismissed decisions are kept as history but no longer show up in answers.",
  inputSchema: z.object({
    action: z.enum(["list", "accept", "dismiss"]),
    ids: z.array(z.string()).default([]).describe("Decision ids to accept or dismiss."),
    title: z.string().optional().describe("New title, when accepting a single decision with an edit."),
    statement: z.string().optional().describe("New statement, when accepting a single decision with an edit."),
    skip: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  readOnly: false,
  async handler(input, ctx) {
    requireWriter(ctx.caller);
    if (input.action === "list") return list(ctx, input.skip, input.limit);
    if (input.ids.length === 0) throw new Error(`Give the ids to ${input.action}.`);
    if ((input.title || input.statement) && (input.action !== "accept" || input.ids.length !== 1)) {
      throw new Error("Edits apply only when accepting a single decision.");
    }

    const set =
      input.action === "accept"
        ? `d.status = 'accepted', d.confirmed_by = $personId, d.confirmed_at = localdatetime(),
           d.title = coalesce($title, d.title), d.statement = coalesce($statement, d.statement)`
        : "d.status = 'dismissed', d.dismissed_by = $personId, d.dismissed_at = localdatetime()";
    const changed = await ctx.graph.query<{ id: string; title: string }>(
      `${FROM_CALLER}
       MATCH (d:Decision) WHERE d.id IN $ids AND d.status = 'proposed' AND ${visible("d")}
       SET ${set}
       RETURN d.id AS id, d.title AS title`,
      { ids: input.ids, personId: ctx.caller.personId, title: input.title ?? null, statement: input.statement ?? null },
    );
    const missed = input.ids.filter((id) => !changed.some((c) => c.id === id));
    const verb = input.action === "accept" ? "Accepted" : "Dismissed";
    return [
      changed.length ? `${verb} by ${ctx.caller.name}: ${changed.map((c) => `${c.title} (${c.id})`).join("; ")}` : `Nothing was ${verb.toLowerCase()}.`,
      missed.length ? `Not found among proposed decisions you can see: ${missed.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  },
});

async function list(ctx: BrainContext, skip: number, limit: number): Promise<string> {
  const [{ total }] = await readAsCaller<{ total: number }>(
    ctx,
    `${FROM_CALLER} MATCH (d:Decision {status: 'proposed'}) WHERE ${visible("d")} RETURN count(d) AS total`,
  );
  if (total === 0) return "No proposed decisions are waiting for review.";
  const rows = await readAsCaller<Proposal>(
    ctx,
    `${FROM_CALLER}
     MATCH (d:Decision {status: 'proposed'}) WHERE ${visible("d")}
     OPTIONAL MATCH (d)-[:DERIVED_FROM]->(ex:Excerpt)-[:IN]->(s:Source) WHERE ${visible("s")}
     OPTIONAL MATCH (d)-[:MADE_BY]->(m:Person)
     RETURN d.id AS id, d.title AS title, d.statement AS statement, m.name AS maker, d.recorded_at AS recordedAt,
            ex.text AS quote, s.title AS sourceTitle, s.url AS url,
            d.source_hash IS NOT NULL AND s.content_hash <> d.source_hash AS stale
     ORDER BY recordedAt, id SKIP $skip LIMIT $limit`,
    { skip, limit },
  );
  return [
    `${rows.length} of ${total} proposed decisions (skipped ${skip}):`,
    ...rows.map((r) =>
      [
        `- ${r.title} (${r.id}), by ${r.maker ?? "unknown"}, found ${day(r.recordedAt)}`,
        `  ${r.statement}`,
        r.quote ? `  Source: "${r.quote}" (${r.sourceTitle}${r.url ? `, ${r.url}` : ""})` : "  Source: none you can see",
        r.stale ? "  The Source text has changed since this was proposed." : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n");
}
