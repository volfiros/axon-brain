import { z } from "zod";
import { FROM_CALLER, readAsCaller, visible } from "../access";
import { requireWriter } from "../caller";
import { day } from "../search";
import { defineTool } from "../tool";

const TEXT_LIMIT = 4000;

type PendingSource = {
  id: string;
  connector: string | null;
  kind: string | null;
  title: string;
  url: string | null;
  createdAt: unknown;
  contentHash: string | null;
  extraction: string;
  text: string | null;
  authors: string[];
  files: string[];
};

const SOURCE_FIELDS = `
  OPTIONAL MATCH (author:Person)-[:AUTHORED]->(s)
  OPTIONAL MATCH (s)-[:TOUCHES]->(f:CodeUnit)
  OPTIONAL MATCH (s)-[:PART_OF]->(:PR)-[:TOUCHES]->(pf:CodeUnit)
  WITH s, collect(DISTINCT author.name) AS authors, collect(DISTINCT f.path) + collect(DISTINCT pf.path) AS files
  RETURN s.id AS id, s.connector AS connector, [l IN labels(s) WHERE l <> 'Source'][0] AS kind, s.title AS title,
         s.url AS url, s.created_at AS createdAt, s.content_hash AS contentHash, s.extraction AS extraction,
         s.text AS text, authors, files`;

export default defineTool({
  name: "pending_sources",
  description:
    "Lists connector Sources (PRs, reviews, docs, work items, chat threads) that still need decision extraction, oldest first. " +
    "Pass source_id with text_offset to read the rest of a long Source.",
  inputSchema: z.object({
    connector: z.string().optional().describe("Only Sources from this connector, for example 'github'."),
    limit: z.number().int().min(1).max(10).default(5),
    skip: z.number().int().min(0).default(0).describe("Sources to skip, for paging past ones you chose not to handle yet."),
    source_id: z.string().optional().describe("Read one Source instead of listing."),
    text_offset: z.number().int().min(0).default(0).describe("Character offset into the Source text when reading one Source."),
  }),
  readOnly: true,
  async handler({ connector, limit, skip, source_id, text_offset }, ctx) {
    requireWriter(ctx.caller);
    if (source_id) {
      const [source] = await readAsCaller<PendingSource>(
        ctx,
        `${FROM_CALLER}
         MATCH (s:Source {id: $id}) WHERE s.deleted_at IS NULL AND ${visible("s")}
         ${SOURCE_FIELDS}`,
        { id: source_id },
      );
      if (!source) return `No Source you can see has the id ${source_id}.`;
      return renderSource(source, text_offset);
    }

    const filter = `s.extraction = 'pending' AND s.deleted_at IS NULL AND ($connector IS NULL OR s.connector = $connector) AND ${visible("s")}`;
    const params = { connector: connector ?? null };
    const [{ total }] = await readAsCaller<{ total: number }>(
      ctx,
      `${FROM_CALLER} MATCH (s:Source) WHERE ${filter} RETURN count(s) AS total`,
      params,
    );
    if (total === 0) return "No Sources you can see are waiting for extraction.";
    const sources = await readAsCaller<PendingSource>(
      ctx,
      `${FROM_CALLER}
       MATCH (s:Source) WHERE ${filter}
       WITH s ORDER BY s.created_at, s.id SKIP $skip LIMIT $limit
       ${SOURCE_FIELDS}
       ORDER BY createdAt, id`,
      { ...params, skip, limit },
    );
    return [
      `${sources.length} of ${total} pending Sources you can see (skipped ${skip}).`,
      ...sources.map((s) => renderSource(s, 0)),
    ].join("\n\n");
  },
});

function renderSource(s: PendingSource, offset: number): string {
  const text = s.text ?? "";
  const slice = text.slice(offset, offset + TEXT_LIMIT);
  const end = offset + slice.length;
  const files = s.files.filter(Boolean).slice(0, 10);
  return [
    `Source ${s.id} (${s.kind ?? "Source"} from ${s.connector ?? "unknown"}, extraction ${s.extraction}): ${s.title}`,
    `URL: ${s.url ?? "none"}`,
    `Authors: ${s.authors.join(", ") || "unknown"}. Created ${day(s.createdAt)}.${files.length ? ` Files: ${files.join(", ")}` : ""}`,
    `content_hash: ${s.contentHash ?? "none"}`,
    end < text.length
      ? `Text, characters ${offset} to ${end} of ${text.length}. Read more with source_id and text_offset ${end}:`
      : `Text, characters ${offset} to ${end} of ${text.length}:`,
    "<<<",
    slice,
    ">>>",
  ].join("\n");
}
