import { BuildingIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { RoleBadge } from "@/components/role-badge";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccount } from "@/lib/auth/session";
import { listMemberships } from "@/lib/workspaces";

import { CreateWorkspaceForm, JoinWorkspaceForm } from "./workspace-forms";

export default async function OnboardingPage() {
  const account = await requireAccount("/onboarding");
  const memberships = await listMemberships(account.id);

  return (
    <PageShell actions={<SignOutButton />}>
      <PageHeader title="Workspaces" description={`Signed in as ${account.username ?? account.name}`} />
      {memberships.length === 0 ? (
        <EmptyState
          icon={<BuildingIcon />}
          title="No workspace yet"
          description="Create one for your company, or join one with an invite code."
        />
      ) : (
        <Table variant="rows">
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {memberships.map((membership) => (
              <TableRow key={membership.id}>
                <TableCell>{membership.name}</TableCell>
                <TableCell>
                  <RoleBadge role={membership.role} />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button variant="tab" size="sm" shape="pill" asChild>
                      <Link href={`/w/${membership.slug}/setup`}>Setup</Link>
                    </Button>
                    <Button variant="tab" size="sm" shape="pill" asChild>
                      <Link href={`/w/${membership.slug}/members`}>Members</Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <CreateWorkspaceForm />
        <JoinWorkspaceForm />
      </div>
    </PageShell>
  );
}
