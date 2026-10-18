import { timingSafeEqual } from "node:crypto";

import { resolvePlane, syncConnector, SyncInProgressError } from "@/lib/connectors/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  if (!(await resolvePlane(workspace).catch(() => null))) return new Response(null, { status: 404 });
  // Vercel Cron sends CRON_SECRET as a bearer token; without it anyone could trigger a sync.
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(req.headers.get("Authorization") ?? "");
  if (!secret || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return new Response(null, { status: 401 });
  }

  try {
    const sources = await syncConnector(workspace, "plane");
    return Response.json({ ok: true, sources });
  } catch (err) {
    if (err instanceof SyncInProgressError) return Response.json({ ok: false, error: err.message }, { status: 409 });
    throw err;
  }
}
