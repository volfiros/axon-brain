import { timingSafeEqual } from "node:crypto";

import { appUrl } from "@/lib/auth";

import { workspaceForSlackTeam } from "./credentials";
import { stateSignature } from "./github/connection";

export type LinkProvider = "slack" | "github";
export type LinkPage = "members" | "setup";

const STATE_TTL_SECONDS = 10 * 60;

// The state names the account that started linking, so a link URL sent to someone else cannot attach their identity.
export function signLinkState(slug: string, accountId: string, page: LinkPage = "members"): string {
  const payload = `link:${slug}:${accountId}:${page}.${Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS}`;
  return `${payload}.${stateSignature(payload)}`;
}

export function verifyLinkState(state: string): { slug: string; accountId: string; page: LinkPage } | null {
  const [body, expires, signature] = state.split(".");
  const [prefix, slug, accountId, page] = (body ?? "").split(":");
  if (prefix !== "link" || !slug || !accountId || !expires || !signature) return null;
  const expected = Buffer.from(stateSignature(`${body}.${expires}`));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Number(expires) <= Date.now() / 1000) return null;
  return { slug, accountId, page: page === "setup" ? "setup" : "members" };
}

// Slack accepts any redirect under a registered Redirect URL, so this reuses the install callback's path.
export function linkRedirectUri(provider: LinkProvider): string {
  return `${appUrl}/api/connectors/${provider}/callback/link`;
}

export function linkConfigured(provider: LinkProvider): boolean {
  const ids = provider === "slack" ? ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"] : ["GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET"];
  return Boolean(process.env.CONNECTOR_STATE_SECRET) && ids.every((name) => process.env[name]);
}

export function linkUrl(provider: LinkProvider, slug: string, accountId: string, page: LinkPage): string {
  const state = signLinkState(slug, accountId, page);
  if (provider === "slack") {
    const query = new URLSearchParams({
      response_type: "code",
      scope: "openid",
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      redirect_uri: linkRedirectUri("slack"),
      state,
    });
    return `https://slack.com/openid/connect/authorize?${query}`;
  }
  const query = new URLSearchParams({ client_id: process.env.GITHUB_APP_CLIENT_ID ?? "", redirect_uri: linkRedirectUri("github"), state });
  return `https://github.com/login/oauth/authorize?${query}`;
}

async function postForm(url: string, body: Record<string, string>, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

// Only a user of the Slack team connected to this Workspace can link.
export async function slackIdentity(slug: string, code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const token = await postForm(
    "https://slack.com/api/openid.connect.token",
    {
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: linkRedirectUri("slack"),
    },
    fetchImpl,
  );
  if (!token.ok || typeof token.access_token !== "string") throw new Error(`Slack sign-in failed: ${token.error ?? "no token"}`);
  const res = await fetchImpl("https://slack.com/api/openid.connect.userInfo", { headers: { Authorization: `Bearer ${token.access_token}` } });
  const info = (await res.json()) as Record<string, unknown>;
  const userId = info["https://slack.com/user_id"];
  const teamId = info["https://slack.com/team_id"];
  if (!info.ok || typeof userId !== "string" || typeof teamId !== "string") throw new Error("Slack sign-in returned no user");
  if ((await workspaceForSlackTeam(teamId)) !== slug) throw new Error("That Slack workspace is not the one connected to this Axon workspace");
  return `slack:${userId}`;
}

export async function githubIdentity(code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const token = await postForm(
    "https://github.com/login/oauth/access_token",
    {
      client_id: process.env.GITHUB_APP_CLIENT_ID ?? "",
      client_secret: process.env.GITHUB_APP_CLIENT_SECRET ?? "",
      code,
      redirect_uri: linkRedirectUri("github"),
    },
    fetchImpl,
  );
  if (typeof token.access_token !== "string") throw new Error(`GitHub sign-in failed: ${token.error ?? "no token"}`);
  const res = await fetchImpl("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json" },
  });
  const user = (await res.json()) as { id?: number };
  if (typeof user.id !== "number") throw new Error("GitHub sign-in returned no user");
  return `github:${user.id}`;
}
