import { appUrl } from "@/lib/auth";

import { assertAdmin, releaseSlackTeam, saveConnector, setConnectorStatus } from "../credentials";
import { signState } from "../github/connection";

export const SLACK_SCOPES = [
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "users:read",
  "users:read.email",
];

type OAuthReply = {
  ok: boolean;
  error?: string;
  access_token?: string;
  token_type?: string;
  team?: { id: string; name?: string };
};

export function slackRedirectUri(): string {
  return `${appUrl}/api/connectors/slack/callback`;
}

export function slackAppConfigured(): boolean {
  return Boolean(
    process.env.SLACK_CLIENT_ID &&
      process.env.SLACK_CLIENT_SECRET &&
      process.env.SLACK_SIGNING_SECRET &&
      process.env.CONNECTOR_STATE_SECRET,
  );
}

export function slackInstallUrl(slug: string): string {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) throw new Error("SLACK_CLIENT_ID is not set");
  const query = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_SCOPES.join(","),
    redirect_uri: slackRedirectUri(),
    state: signState(slug),
  });
  return `https://slack.com/oauth/v2/authorize?${query}`;
}

/** Exchanges the OAuth code for a bot token and stores it encrypted against the Workspace and Slack team. */
export async function completeSlackInstall(
  slug: string,
  accountId: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ teamId: string }> {
  await assertAdmin(slug, accountId);
  const res = await fetchImpl("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: slackRedirectUri(),
    }),
  });
  const reply = (await res.json()) as OAuthReply;
  if (!reply.ok || reply.token_type !== "bot" || !reply.access_token || !reply.team?.id) {
    throw new Error(`Slack install failed: ${reply.error ?? "no bot token"}`);
  }
  await releaseSlackTeam(reply.team.id, slug);
  await saveConnector(slug, "slack", { team_id: reply.team.id, label: reply.team.name ?? reply.team.id }, { token: reply.access_token });
  await setConnectorStatus(slug, "slack", "syncing");
  return { teamId: reply.team.id };
}
