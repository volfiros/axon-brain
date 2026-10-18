import { after } from "next/server";

import { planeEventBatches, verifyPlaneSignature, type PlaneEvent } from "@/lib/connectors/plane";
import { resolvePlane } from "@/lib/connectors/sync";
import { writeBatch } from "@/lib/connectors/write";
import { workspaceGraph } from "@/lib/graph/client";

export async function POST(req: Request, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const credentials = await resolvePlane(workspace).catch(() => null);
  if (!credentials) return new Response(null, { status: 404 });

  const rawBody = await req.text();
  if (!verifyPlaneSignature(rawBody, req.headers.get("X-Plane-Signature"), credentials.webhookSecret)) {
    return new Response(null, { status: 401 });
  }

  let payload: PlaneEvent;
  try {
    payload = JSON.parse(rawBody) as PlaneEvent;
  } catch {
    return new Response(null, { status: 400 });
  }

  const graph = workspaceGraph(workspace);
  after(async () => {
    try {
      for await (const batch of planeEventBatches(payload, { workspace, graph }, credentials.links)) {
        await writeBatch(graph, batch);
      }
    } catch (err) {
      console.error("Plane webhook sync failed:", err);
    }
  });
  return Response.json({ ok: true });
}
