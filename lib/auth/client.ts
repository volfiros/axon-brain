import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [usernameClient(), oauthProviderClient()],
});

// Only same-origin relative paths: "/\evil.com" and "//evil.com" both resolve to another origin and are rejected.
export function safeNextPath(next: string | null, fallback = "/onboarding"): string {
  if (!next || !/^\/(?![/\\])/.test(next)) return fallback;
  const url = new URL(next, window.location.origin);
  return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : fallback;
}

export function followAuthRedirect(data: unknown): boolean {
  const target = data as { redirect?: boolean; url?: string; redirect_uri?: string } | null;
  const url = target?.url ?? target?.redirect_uri;
  if (!url) return false;
  window.location.href = url;
  return true;
}
