import type { ComponentProps } from "react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/session";
import { githubConnection, installUrl, type ConnectorStatus } from "@/lib/connectors/github/connection";

const STATUS_BADGES: Record<ConnectorStatus, { label: string; variant: ComponentProps<typeof Badge>["variant"] }> = {
  syncing: { label: "Syncing", variant: "outline" },
  synced: { label: "Synced", variant: "valid" },
  error: { label: "Sync failed", variant: "warning" },
  disconnected: { label: "Disconnected", variant: "muted" },
};

export default async function ConnectorsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const { workspace, member } = await requireMember(slug, `/w/${slug}/connectors`);
  const connection = await githubConnection(slug);
  const badge = connection && STATUS_BADGES[connection.status];

  return (
    <>
      <PageHeader title="Connectors" description={workspace.name} />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>GitHub</CardTitle>
            {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
          </div>
          {connection && <CardDescription>{connection.repo}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">
            {connection?.synced_at ? `Last synced ${connection.synced_at.replace("T", " ")} UTC` : "Not synced yet"}
          </p>
          {member.role === "Admin" && (
            <Button variant={connection ? "outline" : "default"} size="sm" asChild>
              <a href={installUrl(slug)}>{connection ? "Manage repositories" : "Connect GitHub"}</a>
            </Button>
          )}
        </CardContent>
      </Card>
    </>
  );
}
