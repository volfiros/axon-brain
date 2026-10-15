import { ConfirmButton } from "@/components/confirm-button";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { appUrl } from "@/lib/auth";
import { requireMember } from "@/lib/auth/session";
import { currentInvite, listMembers } from "@/lib/workspaces";

import { leaveWorkspaceAction } from "./actions";
import { InvitePanel } from "./invite-panel";
import { MembersTable } from "./members-table";

export default async function MembersPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const { workspace, member } = await requireMember(slug, `/w/${slug}/members`);
  const isAdmin = member.role === "Admin";
  const members = await listMembers(slug);
  const invite = isAdmin ? await currentInvite(slug) : null;

  return (
    <>
      <PageHeader title="Members" description={workspace.name} />
      <MembersTable slug={slug} members={members} isAdmin={isAdmin} selfId={member.personId} />
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
      <Card>
        <CardHeader>
          <CardTitle>Leave {workspace.name}</CardTitle>
          <CardDescription>You lose access until an Admin invites you again. Your saved decisions stay.</CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmButton
            label="Leave workspace"
            title={`Leave ${workspace.name}?`}
            description="You lose access to its brain and members right away."
            confirmLabel="Leave"
            variant="destructive"
            onConfirm={leaveWorkspaceAction.bind(null, slug)}
          />
        </CardContent>
      </Card>
    </>
  );
}
