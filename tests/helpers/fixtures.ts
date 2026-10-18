import { accountsGraph, workspaceGraph } from "@/lib/graph/client";
import { ensureWorkspaceSchema } from "@/lib/graph/schema";
import type { Role } from "@/lib/roles";

/** A Workspace with its three Roles, written straight to the graph so tests do not depend on sign-in. */
export async function seedWorkspace(slug: string, name = slug): Promise<void> {
  await accountsGraph().query("CREATE (:Workspace {id: $id, slug: $slug, name: $name})", { id: `ws_${slug}`, slug, name });
  const graph = workspaceGraph(slug);
  await ensureWorkspaceSchema(graph);
  await graph.query(
    `MERGE (:Role {id: 'role_admin', name: 'Admin'})
     MERGE (:Role {id: 'role_member', name: 'Member'})
     MERGE (:Role {id: 'role_guest', name: 'Guest'})`,
  );
}

/** An Account that has joined `slug` with `role`, and its Person in the Workspace graph. Returns the Person id. */
export async function seedMember(slug: string, accountId: string, role: Role, name = accountId): Promise<string> {
  const personId = `p_${accountId}`;
  await accountsGraph().query(
    `MERGE (a:Account {id: $accountId}) SET a.name = $name
     WITH a MATCH (w:Workspace {slug: $slug}) MERGE (a)-[:JOINED]->(w)`,
    { accountId, name, slug },
  );
  await workspaceGraph(slug).query(
    `MATCH (r:Role {name: $role})
     CREATE (:Person {id: $personId, account_id: $accountId, name: $name})-[:HAS_ROLE]->(r)`,
    { personId, accountId, name, role },
  );
  return personId;
}

/** An Account with no Workspace yet, as after sign-up. */
export async function seedAccount(accountId: string, name = accountId): Promise<void> {
  await accountsGraph().query("MERGE (a:Account {id: $accountId}) SET a.name = $name", { accountId, name });
}
