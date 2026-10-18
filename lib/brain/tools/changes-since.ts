import { z } from "zod";
import { FROM_CALLER, readAsCaller, visible } from "../access";
import { sourceChanged } from "../source-changes";
import { defineTool } from "../tool";

type Change = { kind: string; id: string; title: string; at: unknown; note: string | null };

const inWindow = (t: string) => `${t} >= localdatetime($since) AND ${t} < localdatetime($until)`;

const CHANGES = `
  ${FROM_CALLER}
  MATCH (d:Decision) WHERE d.status <> 'dismissed' AND ${inWindow("d.recorded_at")} AND ${visible("d")}
  RETURN DISTINCT 'decision created' AS kind, d.id AS id, d.title AS title, d.recorded_at AS at, 'status ' + d.status AS note
  UNION ALL
  ${FROM_CALLER}
  MATCH (d:Decision {status: 'superseded'}) WHERE ${inWindow("d.valid_to")} AND ${visible("d")}
  OPTIONAL MATCH (n:Decision)-[:SUPERSEDES]->(d) WHERE n.status IN ['accepted', 'superseded'] AND ${visible("n")}
  WITH d, collect(DISTINCT n.id) AS replacedBy
  RETURN 'decision superseded' AS kind, d.id AS id, d.title AS title, d.valid_to AS at,
         CASE WHEN size(replacedBy) = 0 THEN null ELSE 'replaced by ' + replacedBy[0] END AS note
  UNION ALL
  ${FROM_CALLER}
  MATCH (d:Decision) WHERE d.confirmed_at IS NOT NULL AND ${inWindow("d.confirmed_at")} AND ${visible("d")}
  OPTIONAL MATCH (confirmer:Person {id: d.confirmed_by})
  RETURN DISTINCT 'proposal accepted' AS kind, d.id AS id, d.title AS title, d.confirmed_at AS at, 'by ' + confirmer.name AS note
  UNION ALL
  ${FROM_CALLER}
  MATCH (d:Decision {status: 'accepted'})-[link:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)
  WHERE ${inWindow("coalesce(s.deleted_at, s.updated_at)")} AND ${visible("d")} AND ${visible("s")} AND ${sourceChanged("link", "s")}
  RETURN DISTINCT 'decision flagged' AS kind, d.id AS id, d.title AS title, coalesce(s.deleted_at, s.updated_at) AS at,
         'source "' + s.title + '"' + CASE WHEN s.deleted_at IS NULL THEN ' was edited' ELSE ' was deleted' END AS note
  UNION ALL
  ${FROM_CALLER}
  MATCH (s:Source) WHERE s.deleted_at IS NULL AND s.updated_at > s.created_at AND ${inWindow("s.updated_at")} AND ${visible("s")}
  RETURN DISTINCT 'source edited' AS kind, s.id AS id, s.title AS title, s.updated_at AS at, s.url AS note
  UNION ALL
  ${FROM_CALLER}
  MATCH (s:Source) WHERE s.deleted_at IS NOT NULL AND ${inWindow("s.deleted_at")} AND ${visible("s")}
  RETURN DISTINCT 'source deleted' AS kind, s.id AS id, s.title AS title, s.deleted_at AS at, s.url AS note`;

export default defineTool({
  name: "changes_since",
  description:
    "Lists what changed in the brain between two dates: decisions created, superseded or flagged by a source change, " +
    "proposals accepted, and sources edited or deleted. Only what the caller can see, newest first, paged.",
  inputSchema: z.object({
    since: z.string().describe("Start of the window, a UTC date or date-time such as '2026-10-01' or '2026-10-01T09:00:00Z'."),
    until: z.string().optional().describe("End of the window, exclusive. Defaults to now."),
    skip: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  readOnly: true,
  async handler(input, ctx) {
    const since = utc(input.since);
    const until = input.until ? utc(input.until) : utc(new Date().toISOString());
    if (since >= until) throw new Error("since must be before until.");

    const rows = (await readAsCaller<Change>(ctx, CHANGES, { since, until })).sort(
      (a, b) => String(b.at).localeCompare(String(a.at)) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
    );
    const window = `${since.replace("T", " ")} to ${until.replace("T", " ")} UTC`;
    if (rows.length === 0) return `Nothing you can see changed from ${window}.`;
    const page = rows.slice(input.skip, input.skip + input.limit);
    return [
      `${page.length} of ${rows.length} changes from ${window} (skipped ${input.skip}):`,
      ...page.map((r) => `- ${String(r.at).slice(0, 16).replace("T", " ")} ${r.kind}: ${r.title} (${r.id})${r.note ? `, ${r.note}` : ""}`),
    ].join("\n");
  },
});

export function utc(value: string): string {
  const zoned = !value.includes("T") || /(Z|[+-]\d\d:?\d\d)$/i.test(value);
  const date = new Date(zoned ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a date: ${value}. Use a form like 2026-10-01.`);
  return date.toISOString().slice(0, 19);
}
