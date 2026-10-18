import { BookOpenIcon, InboxIcon, MessageSquareIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RoleBadge } from "@/components/role-badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireMember } from "@/lib/auth/session";
import { listAnswers } from "@/lib/brain/answers";
import { listDecisions, memberContext } from "@/lib/brain/overview";

import { AnswersTable } from "./answers-table";
import { DecisionsTable } from "./decisions-table";

export default async function WorkspaceHome({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ decision?: string | string[] }>;
}) {
  const { workspace: slug } = await params;
  const { decision: linked } = await searchParams;
  const { workspace, member } = await requireMember(slug, `/w/${slug}`);
  const ctx = memberContext(slug, member);
  const [decisions, proposals, answers] = await Promise.all([
    listDecisions(ctx, ["accepted", "superseded"]),
    listDecisions(ctx, ["proposed"]),
    listAnswers(ctx),
  ]);
  const linkedId = typeof linked === "string" && decisions.some((d) => d.id === linked) ? linked : undefined;

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
              <CardTitle className="font-light">Setup</CardTitle>
              <CardDescription>Connect tools, link accounts and Claude Code</CardDescription>
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
          <TabsTrigger value="answers" variant="pill">
            Saved answers
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
            <DecisionsTable
              key={linkedId}
              decisions={decisions}
              slug={slug}
              canWrite={member.role !== "Guest"}
              initialId={linkedId}
            />
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
        <TabsContent value="answers">
          {answers.length === 0 ? (
            <EmptyState
              icon={<MessageSquareIcon />}
              title="No saved answers"
              description="Save an answer from Claude Code with the save_answer tool."
            />
          ) : (
            <AnswersTable answers={answers} slug={slug} />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
