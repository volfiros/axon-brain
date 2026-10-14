import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getMember, getWorkspace, type AccountRef, type Member, type Workspace } from "@/lib/workspaces";

export async function requireAccount(next: string): Promise<AccountRef> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  const { id, name, username } = session.user as typeof session.user & { username?: string | null };
  return { id, name, username };
}

export async function requireMember(
  slug: string,
  next: string,
): Promise<{ account: AccountRef; workspace: Workspace; member: Member }> {
  const account = await requireAccount(next);
  const workspace = await getWorkspace(slug).catch(() => null);
  const member = workspace ? await getMember(workspace.slug, account.id) : null;
  if (!workspace || !member) notFound();
  return { account, workspace, member };
}
