import { after } from "next/server";

import { eventNeedsToken, github, type GhEvent } from "@/lib/connectors/github";
import { installationToken } from "@/lib/connectors/github/api";
import { setStatus, workspaceForInstallation } from "@/lib/connectors/github/connection";
import { writeBatch } from "@/lib/connectors/write";
import { workspaceGraph } from "@/lib/graph/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!github.verifyWebhook(req, rawBody)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  const event = JSON.parse(rawBody) as GhEvent;
  const installationId = event.installation?.id;
  if (!installationId) return Response.json({ ignored: "No installation" }, { status: 202 });

  const name = req.headers.get("x-github-event");
  if (name === "installation" && (event.action === "deleted" || event.action === "suspend")) {
    await setStatus(installationId, "disconnected");
    return Response.json({ ok: true });
  }

  const slug = await workspaceForInstallation(installationId);
  if (!slug) return Response.json({ ignored: "Installation is not connected to a workspace" }, { status: 202 });

  const headers = new Headers(req.headers);
  // GitHub times out webhooks after 10 seconds, so fetching and writing happen after the response.
  after(async () => {
    try {
      const graph = workspaceGraph(slug);
      const token = eventNeedsToken(name, event) ? await installationToken(installationId) : undefined;
      for await (const batch of github.eventToBatches(headers, event, { workspace: slug, graph, token })) {
        await writeBatch(graph, batch);
      }
    } catch (err) {
      console.error(`GitHub ${name} webhook for ${slug} failed:`, err);
    }
  });
  return Response.json({ ok: true }, { status: 202 });
}
