import { z } from "zod";
import { FROM_CALLER, readAsCaller, shown } from "../access";
import { rankPeople, type RankedPerson } from "../people";
import { defineTool, type BrainContext } from "../tool";

/** Fewest people who together hold more than half of the recorded knowledge. */
export function busFactor(people: Pick<RankedPerson, "score" | "breakdown">[]): number {
  const shares = people.map((p) => p.score - p.breakdown.centrality).sort((a, b) => b - a);
  const total = shares.reduce((sum, s) => sum + s, 0);
  let held = 0;
  for (const [i, share] of shares.entries()) {
    held += share;
    if (held > total / 2) return i + 1;
  }
  return shares.length;
}

async function topicRisk(ctx: BrainContext, topic: string): Promise<string> {
  const people = await rankPeople(ctx, topic, 20);
  if (people === null) return "Name a topic, file or process.";
  if (people.length === 0) return `No one is linked to "${topic}" yet, so nobody holds its knowledge.`;
  const total = people.reduce((sum, p) => sum + p.score - p.breakdown.centrality, 0);
  const factor = busFactor(people);
  return [
    `Bus factor for "${topic}": ${factor}${factor === 1 ? " (one person holds most of it)" : ""}.`,
    ...people
      .slice(0, 5)
      .map((p) => `- ${p.name}${p.onAxon ? "" : " (not on Axon)"}: ${Math.round((100 * (p.score - p.breakdown.centrality)) / total)}%`),
  ].join("\n");
}

type Held = { kind: string; name: string };

async function personRisk(ctx: BrainContext, person: string): Promise<string> {
  const matches = await readAsCaller<{ id: string; name: string }>(
    ctx,
    "MATCH (p:Person) WHERE p.id = $person OR toLower(p.name) = toLower($person) RETURN p.id AS id, p.name AS name",
    { person },
  );
  if (matches.length === 0) return `No person matches "${person}".`;
  if (matches.length > 1) return [`"${person}" matches several people. Use an id:`, ...matches.map((m) => `- ${m.id} ${m.name}`)].join("\n");
  const [p] = matches;
  const held = await readAsCaller<Held>(
    ctx,
    `${FROM_CALLER}
     MATCH (p:Person {id: $id})-[:OWNS|WORKED_ON]->(x)
     WHERE (x:CodeUnit OR x:Process OR x:Project OR x:WorkItem OR x:Topic) AND x.deleted_at IS NULL AND ${shown("x")}
     OPTIONAL MATCH (other:Person)-[:OWNS|WORKED_ON]->(x) WHERE other <> p
     WITH x, count(other) AS others
     WHERE others = 0
     RETURN DISTINCT labels(x)[0] AS kind, coalesce(x.path, x.name, x.title, x.id) AS name
     ORDER BY kind, name`,
    { id: p.id },
  );
  if (held.length === 0) return `Nothing you can see depends on ${p.name} alone.`;
  return [`If ${p.name} leaves, these have no other owner or contributor:`, ...held.map((h) => `- ${h.kind}: ${h.name}`)].join("\n");
}

export default defineTool({
  name: "knowledge_risk",
  description:
    "Bus factor. With topic: who holds its knowledge and how few people hold most of it. " +
    "With person: what they alone own or worked on, at risk if they leave.",
  inputSchema: z.object({
    topic: z.string().optional().describe("A topic, file path or process."),
    person: z.string().optional().describe("A person's name or id."),
  }),
  readOnly: true,
  async handler({ topic, person }, ctx) {
    if (person) return personRisk(ctx, person);
    if (topic) return topicRisk(ctx, topic);
    return "Pass a topic or a person.";
  },
});
