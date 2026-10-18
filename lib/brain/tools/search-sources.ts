import { z } from "zod";
import { searchSources, type FoundSource } from "../sources";
import { day, searchTerms } from "../search";
import { defineTool } from "../tool";

const SNIPPET = 600;

// Long texts such as transcripts are cut around the first query word, so the part that matched is what the agent reads.
export function snippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET) return flat;
  const lower = flat.toLowerCase();
  const at = Math.min(...searchTerms(query).stems.map((w) => lower.indexOf(w)).filter((i) => i >= 0), flat.length);
  const start = Math.max(0, Math.min(at - SNIPPET / 4, flat.length - SNIPPET));
  return `${start > 0 ? "..." : ""}${flat.slice(start, start + SNIPPET)}...`;
}

export function formatSource(s: FoundSource, query: string, index: number): string {
  const who = [s.authors.length ? `by ${s.authors.join(", ")}` : "", s.attendees.length ? `attended by ${s.attendees.join(", ")}` : ""]
    .filter(Boolean)
    .join("; ");
  return [
    `${index}. [${s.kind}] ${s.title} (${day(s.at)})${who ? ` ${who}` : ""}${s.parent ? `, in ${s.parent}` : ""}${s.near ? ", same conversation as a hit above" : ""}`,
    s.url ? `   ${s.url}` : "",
    `   ${snippet(s.text, query)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export default defineTool({
  name: "search_sources",
  description:
    "Searches the raw imported Sources you can see (Slack messages, docs, meetings, PRs, Plane work items) by words, " +
    "and adds the messages around each top hit in the same channel. Use it when no decision covers the question, " +
    "or to find who said, wrote or attended something.",
  inputSchema: z.object({
    query: z.string().describe("Words to search for, for example 'refund rounding webhook'."),
    limit: z.number().int().min(1).max(50).optional().describe("How many Sources to return, 15 by default."),
  }),
  readOnly: true,
  async handler({ query, limit = 15 }, ctx) {
    const found = await searchSources(ctx, query, { limit, direct: Math.ceil(limit * 0.6) });
    if (found === null) return "Search with a few specific words.";
    if (found.length === 0) return `No Source you can see matches "${query}".`;
    return [`${found.length} Source${found.length === 1 ? "" : "s"} for "${query}":`, ...found.map((s, i) => formatSource(s, query, i + 1))].join("\n");
  },
});
