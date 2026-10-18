import { after } from "next/server";

import { workspaceForSlackTeam } from "@/lib/connectors/credentials";
import { slackConnector, type SlackEnvelope } from "@/lib/connectors/slack";
import { resolveSlack } from "@/lib/connectors/sync";
import { writeBatch } from "@/lib/connectors/write";
import { workspaceGraph } from "@/lib/graph/client";

export const dynamic = "force-dynamic";

// One Events URL serves every Slack team that installed the app; the signing secret is the app's, the team picks the Workspace.
export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!slackConnector.verifyWebhook(req, rawBody)) return new Response(null, { status: 401 });

  let payload: SlackEnvelope & { challenge?: string; team_id?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (payload.type === "url_verification") return Response.json({ challenge: payload.challenge });

  const workspace = payload.team_id ? await workspaceForSlackTeam(payload.team_id) : null;
  const credentials = workspace ? await resolveSlack(workspace) : null;
  if (!workspace || !credentials) return Response.json({ ok: true });

  // Slack retries any event not acknowledged within three seconds, so the graph write runs after the reply.
  const graph = workspaceGraph(workspace);
  const headers = req.headers;
  after(async () => {
    try {
      const ctx = { workspace, graph, token: credentials.token };
      for await (const batch of slackConnector.eventToBatches(headers, payload, ctx)) {
        await writeBatch(graph, batch);
      }
    } catch (err) {
      console.error("Slack event sync failed:", err);
    }
  });
  return Response.json({ ok: true });
}
