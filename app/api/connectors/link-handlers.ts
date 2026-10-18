import { requireAccount } from "@/lib/auth/session";
import { linkIdentity } from "@/lib/connectors/identity";
import { githubIdentity, linkConfigured, linkUrl, slackIdentity, verifyLinkState, type LinkProvider } from "@/lib/connectors/link";
import { workspaceGraph } from "@/lib/graph/client";
import { getMember } from "@/lib/workspaces";

export async function startLink(req: Request, provider: LinkProvider): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get("workspace") ?? "";
  const account = await requireAccount(`${url.pathname}${url.search}`);
  const member = slug ? await getMember(slug, account.id).catch(() => null) : null;
  if (!member) return Response.json({ error: "Not a member of this workspace" }, { status: 403 });
  if (!linkConfigured(provider)) return Response.json({ error: `${provider} sign-in is not configured` }, { status: 503 });
  return Response.redirect(linkUrl(provider, slug, account.id), 303);
}

export async function finishLink(req: Request, provider: LinkProvider): Promise<Response> {
  const url = new URL(req.url);
  const state = verifyLinkState(url.searchParams.get("state") ?? "");
  if (!state) return Response.json({ error: "Invalid sign-in callback" }, { status: 400 });
  const back = (result: string) => Response.redirect(new URL(`/w/${state.slug}/members?link=${encodeURIComponent(result)}`, req.url), 303);
  const code = url.searchParams.get("code");
  if (!code) return back("cancelled");

  const account = await requireAccount(`${url.pathname}${url.search}`);
  if (account.id !== state.accountId) return Response.json({ error: "Signed in as a different account" }, { status: 403 });
  const member = await getMember(state.slug, account.id).catch(() => null);
  if (!member) return Response.json({ error: "Not a member of this workspace" }, { status: 403 });

  try {
    const key = provider === "slack" ? await slackIdentity(state.slug, code) : await githubIdentity(code);
    return back(await linkIdentity(workspaceGraph(state.slug), member.personId, key));
  } catch (err) {
    console.error(`Linking ${provider} for ${state.slug} failed:`, err);
    return back("failed");
  }
}
