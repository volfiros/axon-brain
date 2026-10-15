import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { safeNextPath } from "./next-path";

type Search = Record<string, string | string[] | undefined>;

/** Sends a signed-in visitor of /sign-in or /sign-up on to `next`, unless an MCP OAuth flow brought them here. */
export async function redirectSignedIn(search: Search): Promise<void> {
  // The OAuth provider sends people here with client_id and finishes the flow itself after sign-in.
  if (search.client_id) return;
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect(safeNextPath(typeof search.next === "string" ? search.next : null));
}
