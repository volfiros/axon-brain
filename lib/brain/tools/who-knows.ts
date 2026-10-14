import { z } from "zod";
import { FROM_CALLER, readAsCaller, visible } from "../access";
import { searchTerms } from "../search";
import { defineTool } from "../tool";

const TARGET = `
  ${FROM_CALLER}
  MATCH (x)
  WHERE (x:Topic OR x:CodeUnit OR x:Process OR x:Project)
    AND any(w IN $stems WHERE toLower(x.name) CONTAINS w OR toLower(coalesce(x.path, '')) CONTAINS w)`;

const NAME = "coalesce(x.path, x.name)";
const PERSON = "p.id AS personId, p.name AS name, p.title AS title, p.account_id IS NOT NULL AS onAxon";

// One row per signal; points: owns 5, made a current decision 3 (superseded 1), approved 2, authored a source 2, 0.5 per recorded change.
const SCORING = `
  ${TARGET}
  MATCH (p:Person)-[:OWNS]->(x)
  WITH DISTINCT p, x
  RETURN ${PERSON}, 'owns ' + ${NAME} AS signal, 5.0 AS points
  UNION ALL
  ${TARGET}
  MATCH (p:Person)-[w:WORKED_ON]->(x)
  RETURN ${PERSON}, 'changed ' + ${NAME} + ' ' + toString(w.count) + ' times' AS signal, w.count * 0.5 AS points
  UNION ALL
  ${TARGET}
  MATCH (p:Person)-[w:WORKED_ON]->(wi:WorkItem)-[:TOUCHES]->(x)
  RETURN ${PERSON}, 'worked on "' + wi.title + '" ' + toString(w.count) + ' times' AS signal, w.count * 0.5 AS points
  UNION ALL
  ${TARGET}
  MATCH (d:Decision)-[:ABOUT|AFFECTS]->(x) WHERE d.status <> 'dismissed' AND ${visible("d")}
  MATCH (d)-[:MADE_BY]->(p:Person)
  WITH DISTINCT p, d
  RETURN ${PERSON}, 'made "' + d.title + '"' AS signal, CASE d.status WHEN 'superseded' THEN 1.0 ELSE 3.0 END AS points
  UNION ALL
  ${TARGET}
  MATCH (d:Decision)-[:ABOUT|AFFECTS]->(x) WHERE d.status <> 'dismissed' AND ${visible("d")}
  MATCH (d)-[:APPROVED_BY]->(p:Person)
  WITH DISTINCT p, d
  RETURN ${PERSON}, 'approved "' + d.title + '"' AS signal, 2.0 AS points
  UNION ALL
  ${TARGET}
  MATCH (d:Decision)-[:ABOUT|AFFECTS]->(x) WHERE d.status <> 'dismissed' AND ${visible("d")}
  MATCH (d)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)<-[:AUTHORED]-(p:Person) WHERE ${visible("s")}
  WITH DISTINCT p, s
  RETURN ${PERSON}, 'wrote ' + s.title AS signal, 2.0 AS points`;

type Signal = { personId: string; name: string; title: string | null; onAxon: boolean; signal: string; points: number };

export default defineTool({
  name: "who_knows",
  description:
    "Ranks the people who know most about a topic, file or process, from what they own, the decisions they made or approved, the sources they wrote and how often they changed it.",
  inputSchema: z.object({
    topic: z.string().describe("A topic, file path or process, for example 'payment webhooks' or 'src/billing/refunds.ts'."),
  }),
  readOnly: true,
  async handler({ topic }, ctx) {
    const { stems } = searchTerms(topic);
    if (stems.length === 0) return "Name a topic, file or process to rank people for.";
    const signals = await readAsCaller<Signal>(ctx, SCORING, { stems });

    const people = new Map<string, Signal & { score: number; reasons: string[] }>();
    const seen = new Set<string>();
    for (const s of signals) {
      if (seen.has(`${s.personId} ${s.signal}`)) continue;
      seen.add(`${s.personId} ${s.signal}`);
      const person = people.get(s.personId) ?? { ...s, score: 0, reasons: [] };
      person.score += s.points;
      person.reasons.push(`${s.signal} (+${s.points})`);
      people.set(s.personId, person);
    }
    const ranked = [...people.values()].sort((a, b) => b.score - a.score).slice(0, 5);
    if (ranked.length === 0) return `No one in this workspace is linked to "${topic}" yet.`;

    return [
      `People who know about "${topic}":`,
      ...ranked.map(
        (p, i) =>
          `${i + 1}. ${p.name}${p.title ? `, ${p.title}` : ""}${p.onAxon ? "" : " (not on Axon)"}: score ${p.score}. ${p.reasons.join("; ")}`,
      ),
    ].join("\n");
  },
});
