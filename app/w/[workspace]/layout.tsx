import type { ReactNode } from "react";

import { PageShell } from "@/components/page-shell";
import { getAccount, requireMember } from "@/lib/auth/session";
import { listMemberships } from "@/lib/workspaces";

import { workspaceNav } from "./workspace-nav";

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ workspace: string }>;
  children: ReactNode;
}) {
  const { workspace: slug } = await params;
  // Signed out: each page redirects with its own path as ?next, which a layout cannot see.
  if (!(await getAccount())) return children;
  const { account, workspace } = await requireMember(slug, `/w/${slug}`);
  const memberships = await listMemberships(account.id);

  return (
    <PageShell
      nav={workspaceNav(slug)}
      account={account}
      workspace={{ current: workspace, all: memberships.map(({ slug, name }) => ({ slug, name })) }}
    >
      {children}
    </PageShell>
  );
}
