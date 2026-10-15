import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export { safeNextPath } from "./next-path";

export const authClient = createAuthClient({
  plugins: [usernameClient(), oauthProviderClient()],
});

export function followAuthRedirect(data: unknown): boolean {
  const target = data as { redirect?: boolean; url?: string; redirect_uri?: string } | null;
  const url = target?.url ?? target?.redirect_uri;
  if (!url) return false;
  window.location.href = url;
  return true;
}
