import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { SignOutButton } from "@/components/sign-out-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { appUrl } from "@/lib/auth";
import { requireMember } from "@/lib/auth/session";
import { currentInvite, listMembers } from "@/lib/workspaces";

import { workspaceNav } from "../workspace-nav";
import { InvitePanel } from "./invite-panel";
import { MembersTable } from "./members-table";

export default async function MembersPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const { workspace, member } = await requireMember(slug, `/w/${slug}/members`);
  const isAdmin = member.role === "Admin";
  const members = await listMembers(slug);
  const invite = isAdmin ? await currentInvite(slug) : null;

  return (
    <PageShell nav={workspaceNav(slug)} actions={<SignOutButton />}>
      <PageHeader title="Members" description={workspace.name} />
      <MembersTable slug={slug} members={members} isAdmin={isAdmin} />
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Invite people</CardTitle>
            <CardDescription>
              Anyone with this link can join as a Guest for the next 7 days. Replacing it turns off the old link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InvitePanel slug={slug} link={invite ? `${appUrl}/join/${invite}` : null} />
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
