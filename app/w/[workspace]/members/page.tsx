import { ConfirmButton } from "@/components/confirm-button";
import { LinkAccountButtons } from "@/components/link-account-buttons";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { appUrl } from "@/lib/auth";
import { requireMember } from "@/lib/auth/session";
import { linkedIdentities } from "@/lib/connectors/identity";
import { workspaceGraph } from "@/lib/graph/client";
import { currentInvites, INVITE_ROLES, listMembers } from "@/lib/workspaces";

import { leaveWorkspaceAction } from "./actions";
import { InvitePanel } from "./invite-panel";
import { MembersTable } from "./members-table";

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ link?: string }>;
}) {
  const { workspace: slug } = await params;
  const { link } = await searchParams;
  const { workspace, member } = await requireMember(slug, `/w/${slug}/members`);
  const isAdmin = member.role === "Admin";
  const members = await listMembers(slug);
  const invites = isAdmin ? await currentInvites(slug) : null;
  const soleAdmin = isAdmin && members.filter((m) => m.role === "Admin").length === 1;
  const linked = await linkedIdentities(workspaceGraph(slug), member.personId);

  return (
    <>
      <PageHeader title="Members" description={workspace.name} />
      <MembersTable slug={slug} members={members} isAdmin={isAdmin} selfId={member.personId} />
      <Card>
        <CardHeader>
          <CardTitle>Your accounts</CardTitle>
          <CardDescription>Your Slack and GitHub activity counts as yours once linked.</CardDescription>
        </CardHeader>
        <CardContent>
          <LinkAccountButtons slug={slug} linked={linked} from="members" result={link} />
        </CardContent>
      </Card>
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Invite people</CardTitle>
            <CardDescription>
              Anyone with a link joins with its role for the next 7 days. Replacing a link turns off the old one.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {INVITE_ROLES.map((role) => (
              <InvitePanel
                key={role}
                slug={slug}
                role={role}
                link={invites?.[role] ? `${appUrl}/join/${invites[role]}` : null}
              />
            ))}
          </CardContent>
        </Card>
      )}
      {!soleAdmin && (
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
      )}
    </>
  );
}
