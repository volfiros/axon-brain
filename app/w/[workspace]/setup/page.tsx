import { CodeSnippet } from "@/components/code-snippet";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { RoleBadge } from "@/components/role-badge";
import { SignOutButton } from "@/components/sign-out-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/session";
import { workspaceResource } from "@/lib/workspaces";

import { workspaceNav } from "../workspace-nav";

export default async function SetupPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const { workspace, member } = await requireMember(slug, `/w/${slug}/setup`);
  const mcpJson = JSON.stringify({ mcpServers: { axon: { type: "http", url: workspaceResource(slug) } } }, null, 2);

  return (
    <PageShell nav={workspaceNav(slug)} actions={<SignOutButton />}>
      <PageHeader title={workspace.name} actions={<RoleBadge role={member.role} />} />
      <Card>
        <CardHeader>
          <CardTitle>Connect Claude Code</CardTitle>
          <CardDescription>
            Commit this as .mcp.json at the root of your company repositories. Claude Code asks you to sign in to Axon
            the first time you use it there.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeSnippet code={mcpJson} label=".mcp.json" />
        </CardContent>
      </Card>
    </PageShell>
  );
}
