import { after } from "next/server";

import { workspaceForSlackTeam } from "@/lib/connectors/credentials";
import { slackConnector, type SlackEnvelope } from "@/lib/connectors/slack";
import { resolveSlack } from "@/lib/connectors/sync";
import { writeBatch } from "@/lib/connectors/write";
import { workspaceGraph } from "@/lib/graph/client";

export async function POST(req: Request, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const credentials = await resolveSlack(workspace).catch(() => null);
  if (!credentials) return new Response(null, { status: 404 });

  const rawBody = await req.text();
  if (!slackConnector.verifyWebhook(req, rawBody)) return new Response(null, { status: 401 });

  let payload: SlackEnvelope & { challenge?: string; team_id?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (payload.type === "url_verification") return Response.json({ challenge: payload.challenge });
  // Every installed team signs with the same app secret, so a stored install only accepts its own team's events.
  if (!credentials.fromEnv && (!payload.team_id || (await workspaceForSlackTeam(payload.team_id)) !== workspace)) {
    return Response.json({ ok: true });
  }

  // Slack retries any event not acknowledged within three seconds, so the graph write runs after the reply.
  const graph = workspaceGraph(workspace);
  const headers = req.headers;
  after(async () => {
    try {
      for await (const batch of slackConnector.eventToBatches(headers, payload, { workspace, graph, token: credentials.token })) {
        await writeBatch(graph, batch);
      }
    } catch (err) {
      console.error("Slack event sync failed:", err);
    }
  });
  return Response.json({ ok: true });
}
