import { after } from "next/server";

import { slackConnector, type SlackEnvelope } from "@/lib/connectors/slack";
import { writeBatch } from "@/lib/connectors/write";
import { workspaceGraph } from "@/lib/graph/client";

export async function POST(req: Request, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  // Connector credentials in .env belong to one Workspace, so every other slug is refused.
  if (workspace !== process.env.CONNECTORS_WORKSPACE) return new Response(null, { status: 404 });

  const rawBody = await req.text();
  if (!slackConnector.verifyWebhook(req, rawBody)) return new Response(null, { status: 401 });

  let payload: SlackEnvelope & { challenge?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (payload.type === "url_verification") return Response.json({ challenge: payload.challenge });

  // Slack retries any event not acknowledged within three seconds, so the graph write runs after the reply.
  const graph = workspaceGraph(workspace);
  const headers = req.headers;
  after(async () => {
    try {
      for await (const batch of slackConnector.eventToBatches(headers, payload, { workspace, graph })) {
        await writeBatch(graph, batch);
      }
    } catch (err) {
      console.error("Slack event sync failed:", err);
    }
  });
  return Response.json({ ok: true });
}
