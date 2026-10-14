import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

import { appUrl, auth } from "@/lib/auth";
import { getMember, getWorkspace, workspaceResource, type Role } from "@/lib/workspaces";

export type Caller = { accountId: string; personId: string; role: Role };

export class CallerError extends Error {
  constructor(
    readonly code: "invalid_token" | "not_a_member",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Verifies an MCP bearer token for `/w/<workspace>/mcp` and returns the caller's Person and Role.
 * Throws CallerError "invalid_token" (answer 401) or "not_a_member" (answer 403).
 */
export async function resolveCaller(token: string, workspace: string): Promise<Caller> {
  const jwks = createLocalJWKSet((await auth.api.getJwks()) as JSONWebKeySet);
  let accountId: string | undefined;
  try {
    // The audience pins the token to this Workspace's MCP address, so a token for another Workspace is rejected here.
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${appUrl}/api/auth`,
      audience: workspaceResource(workspace),
    });
    accountId = payload.sub;
  } catch {
    throw new CallerError("invalid_token", "The access token is missing, expired or not issued for this workspace.");
  }
  if (!accountId) throw new CallerError("invalid_token", "The access token has no subject.");

  const member = (await getWorkspace(workspace)) && (await getMember(workspace, accountId));
  if (!member) throw new CallerError("not_a_member", "not a member");
  return { accountId, personId: member.personId, role: member.role };
}
