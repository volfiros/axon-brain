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
  const taken = new Error("That workspace address is already taken.");
  if ((await listWorkspaceSlugs()).includes(input.slug)) throw taken;

  const workspace: Workspace = { id: `ws_${randomUUID()}`, slug: input.slug, name: input.name };
  // MERGE is atomic in FalkorDB; a check-then-CREATE in one query let parallel requests both create.
  const [claimed] = await accountsGraph().query<{ id: string }>(
    `MERGE (w:Workspace {slug: $slug})
     ON CREATE SET w.id = $id, w.name = $name, w.created_at = localdatetime()
     RETURN w.id AS id`,
    workspace,
  );
  if (claimed?.id !== workspace.id) throw taken;
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
  const code = randomBytes(16).toString("base64url");
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

// Removing a member deletes only HAS_ROLE and JOINED: the Person stays so MADE_BY and AUTHORED keep their history,
// and a later rejoin finds the same Person again.
async function dropJoined(slug: string, accountId: string): Promise<void> {
  await accountsGraph().query(
    "MATCH (:Account {id: $accountId})-[j:JOINED]->(:Workspace {slug: $slug}) DELETE j",
    { accountId, slug },
  );
}

export async function removeMember(slug: string, adminAccountId: string, personId: string): Promise<void> {
  // The Admin check and the last-Admin guard run inside the query, like setRole.
  const [removed] = await workspaceGraph(slug).query<{ accountId: string }>(
    `MATCH (:Person {account_id: $adminAccountId})-[:HAS_ROLE]->(:Role {name: 'Admin'})
     MATCH (p:Person {id: $personId})-[current:HAS_ROLE]->(r:Role)
     WHERE p.account_id IS NOT NULL
     OPTIONAL MATCH (other:Person)-[:HAS_ROLE]->(:Role {name: 'Admin'})
     WHERE other <> p
     WITH p, current, r, count(other) AS otherAdmins
     WHERE r.name <> 'Admin' OR otherAdmins > 0
     DELETE current
     RETURN p.account_id AS accountId`,
    { adminAccountId, personId },
  );
  if (!removed) {
    throw new Error("Member not removed. Only an Admin can remove people, and a Workspace needs at least one Admin.");
  }
  await dropJoined(slug, removed.accountId);
}

export async function leaveWorkspace(slug: string, accountId: string): Promise<void> {
  const [left] = await workspaceGraph(slug).query<{ personId: string }>(
    `MATCH (p:Person {account_id: $accountId})-[current:HAS_ROLE]->(r:Role)
     OPTIONAL MATCH (other:Person)-[:HAS_ROLE]->(:Role {name: 'Admin'})
     WHERE other <> p
     WITH p, current, r, count(other) AS otherAdmins
     WHERE r.name <> 'Admin' OR otherAdmins > 0
     DELETE current
     RETURN p.id AS personId`,
    { accountId },
  );
  if (!left) throw new Error("You are the only Admin. Make someone else an Admin before you leave.");
  await dropJoined(slug, accountId);
}

export async function revokeInvite(slug: string, adminAccountId: string): Promise<void> {
  // The Invite lives in the accounts graph and the Role in the Workspace graph, so this check cannot share one query.
  const admin = await getMember(slug, adminAccountId);
  if (admin?.role !== "Admin") throw new Error("Only an Admin can revoke invites.");
  await accountsGraph().query("MATCH (i:Invite)-[:FOR]->(:Workspace {slug: $slug}) DETACH DELETE i", { slug });
}

/** Copies a new display name onto the account's Person in every Workspace it joined. */
export async function renamePerson(accountId: string, name: string): Promise<void> {
  const workspaces = await accountsGraph().roQuery<{ slug: string }>(
    "MATCH (:Account {id: $accountId})-[:JOINED]->(w:Workspace) RETURN w.slug AS slug",
    { accountId },
  );
  for (const { slug } of workspaces) {
    await workspaceGraph(slug).query("MATCH (p:Person {account_id: $accountId}) SET p.name = $name", { accountId, name });
  }
}
