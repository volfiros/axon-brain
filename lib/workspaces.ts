import { randomBytes, randomUUID } from "node:crypto";

import { appUrl, auth } from "@/lib/auth";
import { accountsGraph, listWorkspaceSlugs, workspaceGraph } from "@/lib/graph/client";
import { ensureWorkspaceSchema } from "@/lib/graph/schema";
import { ROLES, type Role } from "@/lib/roles";

export { ROLES, type Role };

export type Workspace = { id: string; slug: string; name: string };
export type Membership = Workspace & { role: Role };
export type Member = { personId: string; name: string; handle: string | null; role: Role };
export type AccountRef = { id: string; name: string; username?: string | null };

const INVITE_DAYS = 7;

export function workspaceResource(slug: string): string {
  return `${appUrl}/w/${slug}/mcp`;
}

export async function getWorkspace(slug: string): Promise<Workspace | null> {
  const [row] = await accountsGraph().roQuery<Workspace>(
    "MATCH (w:Workspace {slug: $slug}) RETURN w.id AS id, w.slug AS slug, w.name AS name",
    { slug },
  );
  return row ?? null;
}

export async function getMember(slug: string, accountId: string): Promise<Member | null> {
  const [row] = await workspaceGraph(slug).roQuery<Member>(
    `MATCH (p:Person {account_id: $accountId})-[:HAS_ROLE]->(r:Role)
     RETURN p.id AS personId, p.name AS name, p.handle AS handle, r.name AS role`,
    { accountId },
  );
  return row ?? null;
}

export async function listMemberships(accountId: string): Promise<Membership[]> {
  const workspaces = await accountsGraph().roQuery<Workspace>(
    `MATCH (:Account {id: $accountId})-[:JOINED]->(w:Workspace)
     RETURN w.id AS id, w.slug AS slug, w.name AS name ORDER BY w.name`,
    { accountId },
  );
  const memberships: Membership[] = [];
  for (const workspace of workspaces) {
    const member = await getMember(workspace.slug, accountId);
    if (member) memberships.push({ ...workspace, role: member.role });
  }
  return memberships;
}

export async function listMembers(slug: string): Promise<Member[]> {
  return workspaceGraph(slug).roQuery<Member>(
    `MATCH (p:Person)-[:HAS_ROLE]->(r:Role) WHERE p.account_id IS NOT NULL
     RETURN p.id AS personId, p.name AS name, p.handle AS handle, r.name AS role ORDER BY p.name`,
  );
}

async function addPerson(slug: string, account: AccountRef, role: Role): Promise<void> {
  // An Account maps to at most one Person per Workspace; an existing Person keeps the Role it already has.
  await workspaceGraph(slug).query(
    `MERGE (p:Person {account_id: $accountId})
     ON CREATE SET p.id = $personId, p.name = $name, p.handle = $handle
     WITH p
     MATCH (r:Role {name: $role})
     WHERE NOT (p)-[:HAS_ROLE]->(:Role)
     CREATE (p)-[:HAS_ROLE]->(r)`,
    {
      accountId: account.id,
      personId: `p_${randomUUID()}`,
      name: account.name,
      handle: account.username ?? null,
      role,
    },
  );
  await accountsGraph().query(
    `MATCH (a:Account {id: $accountId}), (w:Workspace {slug: $slug})
     MERGE (a)-[j:JOINED]->(w)
     ON CREATE SET j.at = localdatetime()`,
    { accountId: account.id, slug },
  );
}

async function registerMcpResource(workspace: Workspace): Promise<void> {
  const context = await auth.$context;
  const now = new Date();
  await context.adapter.create({
    model: "oauthResource",
    data: {
      identifier: workspaceResource(workspace.slug),
      name: `Axon ${workspace.name}`,
      disabled: false,
      dpopBoundAccessTokensRequired: false,
      createdAt: now,
      updatedAt: now,
    },
  });
}

export async function createWorkspace(account: AccountRef, input: { name: string; slug: string }): Promise<Workspace> {
  const graph = workspaceGraph(input.slug);
  const taken = (await getWorkspace(input.slug)) || (await listWorkspaceSlugs()).includes(input.slug);
  if (taken) throw new Error("That workspace address is already taken.");

  const workspace: Workspace = { id: `ws_${randomUUID()}`, slug: input.slug, name: input.name };
  await accountsGraph().query(
    "CREATE (:Workspace {id: $id, slug: $slug, name: $name, created_at: localdatetime()})",
    workspace,
  );
  await ensureWorkspaceSchema(graph);
  await graph.query(
    `MERGE (:Role {id: 'role_admin', name: 'Admin'})
     MERGE (:Role {id: 'role_member', name: 'Member'})
     MERGE (:Role {id: 'role_guest', name: 'Guest'})`,
  );
  await addPerson(workspace.slug, account, "Admin");
  await registerMcpResource(workspace);
  return workspace;
}

export async function createInvite(slug: string, adminAccountId: string): Promise<string> {
  const admin = await getMember(slug, adminAccountId);
  if (admin?.role !== "Admin") throw new Error("Only an Admin can invite people.");
  const code = randomBytes(6).toString("base64url");
  // One live invite per Workspace: making a new one retires the old code.
  await accountsGraph().query(
    `MATCH (w:Workspace {slug: $slug})
     OPTIONAL MATCH (old:Invite)-[:FOR]->(w)
     DETACH DELETE old
     WITH DISTINCT w
     CREATE (:Invite {code: $code, created_at: localdatetime(), expires_at: localdatetime() + duration({days: $days})})-[:FOR]->(w)`,
    { slug, code, days: INVITE_DAYS },
  );
  return code;
}

export async function currentInvite(slug: string): Promise<string | null> {
  const [row] = await accountsGraph().roQuery<{ code: string }>(
    `MATCH (i:Invite)-[:FOR]->(:Workspace {slug: $slug})
     WHERE i.expires_at > localdatetime()
     RETURN i.code AS code`,
    { slug },
  );
  return row?.code ?? null;
}

export async function findInvite(code: string): Promise<Workspace | null> {
  const [workspace] = await accountsGraph().roQuery<Workspace>(
    `MATCH (i:Invite {code: $code})-[:FOR]->(w:Workspace)
     WHERE i.expires_at > localdatetime()
     RETURN w.id AS id, w.slug AS slug, w.name AS name`,
    { code: code.trim() },
  );
  return workspace ?? null;
}

export async function joinWithCode(account: AccountRef, code: string): Promise<Workspace> {
  const workspace = await findInvite(code);
  if (!workspace) throw new Error("That invite code is not valid or has expired.");
  await addPerson(workspace.slug, account, "Guest");
  return workspace;
}

export async function setRole(slug: string, adminAccountId: string, personId: string, role: Role): Promise<void> {
  if (!ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
  // The Admin check and the last-Admin guard run inside the query, so the change cannot apply without them.
  const changed = await workspaceGraph(slug).query(
    `MATCH (:Person {account_id: $adminAccountId})-[:HAS_ROLE]->(:Role {name: 'Admin'})
     MATCH (p:Person {id: $personId})-[current:HAS_ROLE]->(from:Role)
     MATCH (to:Role {name: $role})
     OPTIONAL MATCH (other:Person)-[:HAS_ROLE]->(:Role {name: 'Admin'})
     WHERE other <> p
     WITH p, current, from, to, count(other) AS otherAdmins
     WHERE from.name <> 'Admin' OR to.name = 'Admin' OR otherAdmins > 0
     DELETE current
     CREATE (p)-[:HAS_ROLE]->(to)
     RETURN p.id AS personId`,
    { adminAccountId, personId, role },
  );
  if (changed.length === 0) {
    throw new Error("Role not changed. Only an Admin can change roles, and a Workspace needs at least one Admin.");
  }
}
