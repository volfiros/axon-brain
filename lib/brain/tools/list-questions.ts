import { z } from "zod";
import { FROM_CALLER, readAsCaller, visible } from "../access";
import { day, searchTerms } from "../search";
import { defineTool } from "../tool";

type Question = { id: string; text: string; at: unknown; asker: string | null; source: string | null; topics: string[] };

export default defineTool({
  name: "list_questions",
  description: "Open questions sessions left unanswered, newest first, optionally about a topic, with who asked and where.",
  inputSchema: z.object({
    topic: z.string().optional().describe("Words from the question or its topic."),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  readOnly: true,
  async handler({ topic, limit }, ctx) {
    const stems = topic ? searchTerms(topic).stems : [];
    if (topic && stems.length === 0) return "Name a topic with searchable words.";
    const rows = await readAsCaller<Question>(
      ctx,
      `${FROM_CALLER}
       MATCH (q:Question {status: 'open'}) WHERE ${visible("q")}
       OPTIONAL MATCH (q)-[:ABOUT]->(t:Topic)
       WITH q, collect(DISTINCT t.name) AS topics
       WHERE size($stems) = 0 OR all(w IN $stems WHERE toLower(q.text) CONTAINS w OR any(n IN topics WHERE n CONTAINS w))
       OPTIONAL MATCH (q)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)
       OPTIONAL MATCH (asker:Person)-[:AUTHORED]->(s)
       RETURN q.id AS id, q.text AS text, q.recorded_at AS at, head(collect(DISTINCT asker.name)) AS asker,
              head(collect(DISTINCT s.title)) AS source, topics
       ORDER BY at DESC, id
       LIMIT $limit`,
      { stems, limit },
    );
    if (rows.length === 0) return topic ? `No open question you can see about "${topic}".` : "No open questions you can see.";
    return [
      `${rows.length} open question${rows.length === 1 ? "" : "s"}:`,
      ...rows.map((q) => `- ${q.text} (${q.id}), asked ${day(q.at)} by ${q.asker ?? "unknown"}${q.source ? ` in ${q.source}` : ""}`),
    ].join("\n");
  },
});
