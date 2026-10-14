import { after } from "next/server";

import { planeConnector, type PlaneEvent } from "@/lib/connectors/plane";
import { writeBatch } from "@/lib/connectors/write";
import { workspaceGraph } from "@/lib/graph/client";

export async function POST(req: Request, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  // Connector credentials in .env belong to one Workspace, so every other slug is refused.
  if (workspace !== process.env.CONNECTORS_WORKSPACE) return new Response(null, { status: 404 });

  const rawBody = await req.text();
  if (!planeConnector.verifyWebhook(req, rawBody)) return new Response(null, { status: 401 });

  let payload: PlaneEvent;
  try {
    payload = JSON.parse(rawBody) as PlaneEvent;
  } catch {
    return new Response(null, { status: 400 });
  }

  const graph = workspaceGraph(workspace);
  const headers = req.headers;
  after(async () => {
    try {
      for await (const batch of planeConnector.eventToBatches(headers, payload, { workspace, graph })) {
        await writeBatch(graph, batch);
      }
    } catch (err) {
      console.error("Plane webhook sync failed:", err);
    }
  });
  return Response.json({ ok: true });
}
