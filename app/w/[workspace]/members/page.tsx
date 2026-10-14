import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { RoleBadge } from "@/components/role-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { appUrl } from "@/lib/auth";
import { requireMember } from "@/lib/auth/session";
import { currentInvite, listMembers } from "@/lib/workspaces";

import { WorkspaceNav } from "../workspace-nav";
import { InvitePanel } from "./invite-panel";
import { RoleSelect } from "./role-select";

export default async function MembersPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const { workspace, member } = await requireMember(slug, `/w/${slug}/members`);
  const isAdmin = member.role === "Admin";
  const members = await listMembers(slug);
  const invite = isAdmin ? await currentInvite(slug) : null;

  return (
    <PageShell actions={<WorkspaceNav slug={slug} />}>
      <PageHeader title="Members" description={workspace.name} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Username</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((person) => (
            <TableRow key={person.personId}>
              <TableCell>{person.name}</TableCell>
              <TableCell className="text-muted-foreground">{person.handle}</TableCell>
              <TableCell>
                {isAdmin ? (
                  <RoleSelect slug={slug} personId={person.personId} role={person.role} />
                ) : (
                  <RoleBadge role={person.role} />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
