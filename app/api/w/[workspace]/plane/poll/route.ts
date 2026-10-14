import { timingSafeEqual } from "node:crypto";

import { planeConnector } from "@/lib/connectors/plane";
import { writeBatch } from "@/lib/connectors/write";
import { workspaceGraph } from "@/lib/graph/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  if (workspace !== process.env.CONNECTORS_WORKSPACE) return new Response(null, { status: 404 });
  // Vercel Cron sends CRON_SECRET as a bearer token; without it anyone could trigger a sync.
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(req.headers.get("Authorization") ?? "");
  if (!secret || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return new Response(null, { status: 401 });
  }

  const graph = workspaceGraph(workspace);
  const [latest] = await graph.roQuery<{ since: unknown }>(
    "MATCH (s:Source {connector: 'plane'}) RETURN max(s.updated_at) AS since",
  );
  const since = latest?.since ? `${String(latest.since)}Z` : undefined;

  let sources = 0;
  for await (const batch of planeConnector.backfill({ workspace, graph, since })) {
    await writeBatch(graph, batch);
    sources += batch.sources?.length ?? 0;
  }
  return Response.json({ ok: true, since: since ?? null, sources });
}
