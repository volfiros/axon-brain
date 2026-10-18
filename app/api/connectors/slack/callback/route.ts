import { after } from "next/server";

import { requireAccount } from "@/lib/auth/session";
import { verifyState } from "@/lib/connectors/github/connection";
import { completeSlackInstall } from "@/lib/connectors/slack/oauth";
import { syncConnector } from "@/lib/connectors/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = verifyState(url.searchParams.get("state") ?? "");
  if (!slug) return Response.json({ error: "Invalid Slack callback" }, { status: 400 });
  const back = new URL(`/w/${slug}/connectors`, req.url);
  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(back, 303);

  const account = await requireAccount(`${url.pathname}${url.search}`);
  try {
    await completeSlackInstall(slug, account.id, code);
  } catch (err) {
    const message = (err as Error).message;
    const status = message.startsWith("Only a Workspace Admin") ? 403 : 502;
    return Response.json({ error: message }, { status });
  }
  after(() => syncConnector(slug, "slack").catch((err) => console.error(`Slack import for ${slug} failed:`, err)));
  return Response.redirect(back, 303);
}
