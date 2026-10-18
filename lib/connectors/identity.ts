import type { AxonGraph } from "@/lib/graph/client";

export type LinkResult = "linked" | "already linked" | "taken";

const OUTGOING = ["AUTHORED", "OWNS", "MEMBER_OF", "SAVED"];
const INCOMING = ["MADE_BY", "APPROVED_BY", "VISIBLE_TO"];

/** Moves a proven tool identity, and the imported Person holding it, onto the member. Refuses another member's. */
export async function linkIdentity(graph: AxonGraph, memberId: string, key: string): Promise<LinkResult> {
  const [holder] = await graph.query<{ id: string; accountId: string | null }>(
    "MATCH (p:Person) WHERE $key IN p.external_ids RETURN p.id AS id, p.account_id AS accountId LIMIT 1",
    { key },
  );
  if (holder?.accountId && holder.id !== memberId) return "taken";

  let result: LinkResult = "already linked";
  if (!holder) {
    await graph.query("MATCH (m:Person {id: $memberId}) SET m.external_ids = coalesce(m.external_ids, []) + $key", { memberId, key });
    result = "linked";
  } else if (holder.id !== memberId) {
    await absorb(graph, memberId, holder.id);
    result = "linked";
  }
  await absorbSameEmail(graph, memberId);
  return result;
}

// The email came from Slack or Plane, which verify it; Axon sign-up does not, so only imported Persons are absorbed.
async function absorbSameEmail(graph: AxonGraph, memberId: string) {
  const rows = await graph.query<{ id: string }>(
    `MATCH (m:Person {id: $memberId}) WHERE m.email IS NOT NULL
     MATCH (p:Person {email: m.email}) WHERE p.id <> m.id AND p.account_id IS NULL
     RETURN p.id AS id`,
    { memberId },
  );
  for (const { id } of rows) await absorb(graph, memberId, id);
}

async function absorb(graph: AxonGraph, memberId: string, holderId: string) {
  const params = { memberId, holderId };
  for (const type of OUTGOING) {
    await graph.query(
      `MATCH (h:Person {id: $holderId})-[r:${type}]->(x), (m:Person {id: $memberId})
       MERGE (m)-[moved:${type}]->(x)
       SET moved += properties(r)
       DELETE r`,
      params,
    );
  }
  for (const type of INCOMING) {
    await graph.query(
      `MATCH (x)-[r:${type}]->(h:Person {id: $holderId}), (m:Person {id: $memberId})
       MERGE (x)-[moved:${type}]->(m)
       SET moved += properties(r)
       DELETE r`,
      params,
    );
  }
  await graph.query(
    `MATCH (h:Person {id: $holderId})-[r:WORKED_ON]->(x), (m:Person {id: $memberId})
     MERGE (m)-[w:WORKED_ON]->(x)
     SET w.count = coalesce(w.count, 0) + coalesce(r.count, 0),
         w.last_at = CASE WHEN w.last_at IS NULL OR r.last_at > w.last_at THEN r.last_at ELSE w.last_at END
     DELETE r`,
    params,
  );
  await graph.query(
    `MATCH (h:Person {id: $holderId}), (m:Person {id: $memberId})
     SET m.external_ids = coalesce(m.external_ids, []) + [k IN coalesce(h.external_ids, []) WHERE NOT k IN coalesce(m.external_ids, [])],
         m.email = coalesce(m.email, h.email)
     DETACH DELETE h`,
    params,
  );
}

export async function linkedIdentities(graph: AxonGraph, personId: string): Promise<string[]> {
  const [row] = await graph.roQuery<{ ids: string[] | null }>("MATCH (p:Person {id: $personId}) RETURN p.external_ids AS ids", { personId });
  return row?.ids ?? [];
}
