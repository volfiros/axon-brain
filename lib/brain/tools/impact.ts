import { z } from "zod";
import { FROM_CALLER, readAsCaller, restrictedNote, visible } from "../access";
import { searchTerms } from "../search";
import { defineTool } from "../tool";

const FIND_REASON = (filter: string, ret: string) => `
  ${FROM_CALLER}
  MATCH (c)
  WHERE (c:Constraint OR c:Assumption)
    AND (c.id = $text OR all(w IN $stems WHERE toLower(c.statement) CONTAINS w))
    AND ${filter}
  ${ret}`;

type Reason = { id: string; kind: string; statement: string };
type Dependent = { id: string; title: string; status: string; maker: string | null; affects: string[]; owners: string[] };

export default defineTool({
  name: "impact",
  description:
    "When a constraint or assumption stops being true, lists every current decision that relied on it (BECAUSE_OF), what each one affects and who owns that.",
  inputSchema: z.object({
    constraint: z.string().describe("Id of the constraint or assumption, or words from its statement."),
  }),
  readOnly: true,
  async handler({ constraint }, ctx) {
    const params = { text: constraint, stems: searchTerms(constraint).stems };
    const reasons = await readAsCaller<Reason>(
      ctx,
      FIND_REASON(visible("c"), "RETURN c.id AS id, labels(c)[0] AS kind, c.statement AS statement"),
      params,
    );
    if (reasons.length === 0) {
      const [hidden] = await readAsCaller<{ n: number }>(ctx, FIND_REASON(`NOT ${visible("c")}`, "RETURN count(c) AS n"), params);
      return (await restrictedNote(ctx, hidden?.n ?? 0, "constraint")) || `No constraint or assumption matches "${constraint}".`;
    }
    if (reasons.length > 1) {
      return ["Several match. Call impact again with one id:", ...reasons.map((r) => `- ${r.id} (${r.kind}): ${r.statement}`)].join("\n");
    }

    const reason = reasons[0];
    const dependents = await readAsCaller<Dependent>(
      ctx,
      `${FROM_CALLER}
       MATCH (c {id: $id})<-[:BECAUSE_OF]-(d:Decision)
       WHERE NOT d.status IN ['superseded', 'dismissed'] AND ${visible("d")}
       OPTIONAL MATCH (d)-[:MADE_BY]->(maker:Person)
       OPTIONAL MATCH (d)-[:AFFECTS]->(x)
       OPTIONAL MATCH (x)<-[:OWNS]-(owner:Person)
       RETURN d.id AS id, d.title AS title, d.status AS status, maker.name AS maker,
              collect(DISTINCT coalesce(x.path, x.name)) AS affects, collect(DISTINCT owner.name) AS owners`,
      { id: reason.id },
    );
    const [hidden] = await readAsCaller<{ n: number }>(
      ctx,
      `${FROM_CALLER}
       MATCH (c {id: $id})<-[:BECAUSE_OF]-(d:Decision)
       WHERE NOT d.status IN ['superseded', 'dismissed'] AND NOT ${visible("d")}
       RETURN count(d) AS n`,
      { id: reason.id },
    );

    const lines = [`If this ${reason.kind.toLowerCase()} stops being true: "${reason.statement}" (${reason.id})`];
    if (dependents.length === 0) lines.push("No current decision you can see relies on it.");
    else lines.push(`${dependents.length} decision${dependents.length === 1 ? "" : "s"} relied on it:`);
    for (const d of dependents) {
      lines.push(
        `- ${d.title} (${d.status}, ${d.id}), decided by ${d.maker ?? "unknown"}. ` +
          `Affects: ${d.affects.join(", ") || "nothing linked"}. Owners to tell: ${d.owners.join(", ") || "none recorded"}.`,
      );
      lines.push(`  Path: (${reason.kind}: ${reason.id})<-[:BECAUSE_OF]-(Decision: ${d.title})`);
    }
    const restricted = await restrictedNote(ctx, hidden?.n ?? 0, "decision");
    if (restricted) lines.push(restricted);
    if (dependents.length) lines.push("Review each one, then use supersede for any that should change.");
    return lines.join("\n");
  },
});
