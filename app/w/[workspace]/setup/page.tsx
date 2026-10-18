import Link from "next/link";

import { CodeSnippet } from "@/components/code-snippet";
import { LinkAccountButtons } from "@/components/link-account-buttons";
import { PageHeader } from "@/components/page-header";
import { RoleBadge } from "@/components/role-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/session";
import { linkedIdentities } from "@/lib/connectors/identity";
import { workspaceGraph } from "@/lib/graph/client";
import { workspaceResource } from "@/lib/workspaces";

export default async function SetupPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const { workspace, member } = await requireMember(slug, `/w/${slug}/setup`);
  const url = workspaceResource(slug);
  const mcpJson = JSON.stringify({ mcpServers: { axon: { type: "http", url } } }, null, 2);
  const linked = await linkedIdentities(workspaceGraph(slug), member.personId);

  const steps = [
    ...(member.role === "Admin"
      ? [
          {
            title: "Connect your tools",
            description: "Connect GitHub, Slack and Plane once for the whole workspace.",
            content: (
              <Button variant="brand" shape="pill" asChild>
                <Link href={`/w/${slug}/connectors`}>Open connectors</Link>
              </Button>
            ),
          },
        ]
      : []),
    {
      title: "Link your accounts",
      description: "Your Slack and GitHub activity then counts as yours.",
      content: <LinkAccountButtons slug={slug} linked={linked} />,
    },
    {
      title: "Add Axon to Claude Code",
      description: "Commit this as .mcp.json at the root of your repository, or run the command.",
      content: (
        <div className="flex flex-col gap-3">
          <CodeSnippet code={mcpJson} label=".mcp.json" />
          <CodeSnippet code={`claude mcp add --transport http axon ${url}`} label="command" />
        </div>
      ),
    },
    {
      title: "Sign in",
      description: "In Claude Code, run /mcp, choose axon, then Authenticate. Approve in the browser.",
    },
    {
      title: "Ask",
      description: "Try: what did we decide about refunds, and why?",
    },
  ];

  return (
    <>
      <PageHeader title="Setup" description={workspace.name} actions={<RoleBadge role={member.role} />} />
      {steps.map((step, i) => (
        <Card key={step.title}>
          <CardHeader>
            <CardTitle>
              {i + 1}. {step.title}
            </CardTitle>
            <CardDescription>{step.description}</CardDescription>
          </CardHeader>
          {step.content && <CardContent>{step.content}</CardContent>}
        </Card>
      ))}
    </>
  );
}
