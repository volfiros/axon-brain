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
  if (holder?.id === memberId) return "already linked";
  if (holder?.accountId) return "taken";

  if (!holder) {
    await graph.query("MATCH (m:Person {id: $memberId}) SET m.external_ids = coalesce(m.external_ids, []) + $key", { memberId, key });
    return "linked";
  }

  const params = { memberId, holderId: holder.id };
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
  return "linked";
}

export async function linkedIdentities(graph: AxonGraph, personId: string): Promise<string[]> {
  const [row] = await graph.roQuery<{ ids: string[] | null }>("MATCH (p:Person {id: $personId}) RETURN p.external_ids AS ids", { personId });
  return row?.ids ?? [];
}
