import type { AuthInfo } from "@modelcontextprotocol/server";
import { workspaceGraph } from "@/lib/graph/client";

export type RoleName = "Admin" | "Member" | "Guest";

export type Caller = {
  personId: string;
  name: string;
  role: RoleName;
  teams: string[];
  workspace: string;
};

/**
 * Turns a bearer token and the workspace slug from the URL into the calling Person.
 * Throws "not a member" when the token's Account has no Person in this workspace.
 * The sign-in session replaces the token check here with Better Auth.
 */
export async function resolveCaller(token: string, workspace: string): Promise<Caller> {
  const accountId = devAccountId(token);
  if (!accountId) throw new Error("not a member");
  const [row] = await workspaceGraph(workspace).roQuery<Omit<Caller, "workspace">>(
    `MATCH (p:Person {account_id: $accountId})-[:HAS_ROLE]->(r:Role)
     OPTIONAL MATCH (p)-[:MEMBER_OF]->(t:Team)
     RETURN p.id AS personId, p.name AS name, r.name AS role, collect(t.name) AS teams`,
    { accountId },
  );
  if (!row) throw new Error("not a member");
  return { ...row, workspace };
}

// Stand-in until Better Auth merges: "dev:<account_id>" works only under `next dev`, never in a build.
function devAccountId(token: string): string | undefined {
  if (process.env.NODE_ENV !== "development" || !token.startsWith("dev:")) return undefined;
  return token.slice("dev:".length);
}

export async function authenticate(token: string | undefined, workspace: string): Promise<AuthInfo | undefined> {
  if (!token) return undefined;
  try {
    const caller = await resolveCaller(token, workspace);
    return { token, clientId: caller.personId, scopes: [], extra: { caller } };
  } catch {
    return undefined;
  }
}

export function callerFrom(auth: AuthInfo | undefined): Caller {
  const caller = auth?.extra?.caller as Caller | undefined;
  if (!caller) throw new Error("not a member");
  return caller;
}

export function requireWriter(caller: Caller): void {
  if (caller.role === "Guest") {
    throw new Error("Guests can read the brain but not save to it. Ask a Member or Admin to save this.");
  }
}
