import { BookOpenIcon, InboxIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RoleBadge } from "@/components/role-badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireMember } from "@/lib/auth/session";
import { listDecisions, memberContext } from "@/lib/brain/overview";

import { DecisionsTable } from "./decisions-table";

export default async function WorkspaceHome({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const { workspace, member } = await requireMember(slug, `/w/${slug}`);
  const ctx = memberContext(slug, member);
  const [decisions, proposals] = await Promise.all([
    listDecisions(ctx, ["accepted", "superseded"]),
    listDecisions(ctx, ["proposed"]),
  ]);

  return (
    <>
      <PageHeader title={workspace.name} actions={<RoleBadge role={member.role} />} />
      <div className="grid gap-4 md:grid-cols-2">
        <Link href={`/w/${slug}/members`}>
          <Card className="hover:bg-surface-hover h-full transition-colors">
            <CardHeader>
              <CardTitle className="font-light">Members</CardTitle>
              <CardDescription>Roles and invites</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href={`/w/${slug}/setup`}>
          <Card className="hover:bg-surface-hover h-full transition-colors">
            <CardHeader>
              <CardTitle className="font-light">MCP setup</CardTitle>
              <CardDescription>Connect Claude Code</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
      <Tabs defaultValue="decisions" className="gap-4">
        <TabsList variant="pill">
          <TabsTrigger value="decisions" variant="pill">
            Decisions
          </TabsTrigger>
          <TabsTrigger value="proposals" variant="pill">
            Proposals
          </TabsTrigger>
        </TabsList>
        <TabsContent value="decisions">
          {decisions.length === 0 ? (
            <EmptyState
              icon={<BookOpenIcon />}
              title="No decisions yet"
              description="Save one from Claude Code with the save tool."
            />
          ) : (
            <DecisionsTable decisions={decisions} slug={slug} canWrite={member.role !== "Guest"} />
          )}
        </TabsContent>
        <TabsContent value="proposals">
          {proposals.length === 0 ? (
            <EmptyState
              icon={<InboxIcon />}
              title="Nothing waiting for review"
              description="Review proposals from Claude Code with review_proposals."
            />
          ) : (
            <DecisionsTable decisions={proposals} slug={slug} canWrite={member.role !== "Guest"} />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
