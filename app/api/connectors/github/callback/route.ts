import { after } from "next/server";

import { requireAccount } from "@/lib/auth/session";
import { connectInstallation, syncInstallation, verifyState } from "@/lib/connectors/github/connection";
import { getMember } from "@/lib/workspaces";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const installationId = Number(url.searchParams.get("installation_id"));
  const slug = verifyState(url.searchParams.get("state") ?? "");
  if (!slug || !Number.isInteger(installationId) || installationId <= 0) {
    return Response.json({ error: "Invalid install callback" }, { status: 400 });
  }
  const account = await requireAccount(`${url.pathname}${url.search}`);
  const member = await getMember(slug, account.id).catch(() => null);
  if (member?.role !== "Admin") {
    return Response.json({ error: "Only a Workspace Admin can connect GitHub" }, { status: 403 });
  }
  await connectInstallation(slug, installationId);
  after(() =>
    syncInstallation(slug, installationId).catch((err) =>
      console.error(`GitHub backfill for ${slug} failed:`, err),
    ),
  );
  return Response.redirect(new URL(`/w/${slug}/connectors`, req.url), 303);
}
