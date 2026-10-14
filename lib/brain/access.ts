import type { Params, Row } from "@/lib/graph/client";
import type { BrainContext } from "./tool";

// Every agent read starts here, so access is decided inside Cypher from the calling Person.
export const FROM_CALLER = "MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)";

/** Cypher predicate: the node behind `alias` is VISIBLE_TO the caller, one of their Teams or their Role. */
export function visible(alias: string): string {
  return `((${alias})-[:VISIBLE_TO]->(u) OR (${alias})-[:VISIBLE_TO]->(role) OR (${alias})-[:VISIBLE_TO]->(:Team)<-[:MEMBER_OF]-(u))`;
}

export function readAsCaller<T = Row>(ctx: BrainContext, cypher: string, params: Params = {}): Promise<T[]> {
  return ctx.graph.roQuery<T>(cypher, { ...params, personId: ctx.caller.personId });
}

export async function adminName(ctx: BrainContext): Promise<string> {
  const [row] = await ctx.graph.roQuery<{ name: string }>(
    "MATCH (p:Person)-[:HAS_ROLE]->(:Role {name: 'Admin'}) RETURN p.name AS name ORDER BY p.name LIMIT 1",
  );
  return row?.name ?? "a workspace Admin";
}

export async function restrictedNote(ctx: BrainContext, count: number, what: string): Promise<string> {
  if (count === 0) return "";
  const admin = await adminName(ctx);
  return count === 1
    ? `There is a restricted ${what} on this, ask ${admin}.`
    : `There are ${count} restricted ${what}s on this, ask ${admin}.`;
}
