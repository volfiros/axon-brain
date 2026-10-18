import type { ComponentProps, ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/session";
import { encryptionConfigured, getConnector, sourceCounts, type StoredConnector } from "@/lib/connectors/credentials";
import { githubAppConfigured, githubConnection, installUrl, type ConnectorStatus } from "@/lib/connectors/github/connection";
import { planeWebhookUrl } from "@/lib/connectors/plane/connect";
import { slackAppConfigured, slackInstallUrl } from "@/lib/connectors/slack/oauth";
import { isStale, resolvePlane, resolveSlack } from "@/lib/connectors/sync";

import type { ConnectorKey } from "./actions";
import { ConnectorActions, RefreshWhileSyncing } from "./connector-actions";
import { PlaneConnectForm, PlaneWebhookForm } from "./plane-forms";

export const dynamic = "force-dynamic";
// Sync now runs the import after its response; Vercel allows that work up to this many seconds.
export const maxDuration = 300;

type State = "not_connected" | "connected" | "syncing" | "stopped" | "error";

const BADGES: Record<State, { label: string; variant: ComponentProps<typeof Badge>["variant"] }> = {
  not_connected: { label: "Not connected", variant: "muted" },
  connected: { label: "Connected", variant: "valid" },
  syncing: { label: "Syncing", variant: "outline" },
  stopped: { label: "Sync stopped", variant: "warning" },
  error: { label: "Sync failed", variant: "warning" },
};

function stateOf(connected: boolean, status: ConnectorStatus | undefined, syncStartedAt?: string | null): State {
  if (!connected) return "not_connected";
  if (status === "syncing") return syncStartedAt !== undefined && isStale(syncStartedAt) ? "stopped" : "syncing";
  if (status === "error") return "error";
  return "connected";
}

function syncedLine(syncedAt: string | null | undefined, count: number): string {
  const synced = syncedAt ? `Last synced ${syncedAt.replace("T", " ")} UTC` : "Not synced yet";
  return `${synced}. ${count} ${count === 1 ? "source" : "sources"}.`;
}

function errorLine(state: State, stored: StoredConnector | null): string | null {
  if (state === "stopped") return "The last sync did not finish. Sync now runs it again.";
  return state === "error" ? (stored?.error ?? "The last sync failed.") : null;
}

function ConnectorCard({
  title,
  state,
  description,
  details,
  error,
  children,
}: {
  title: string;
  state: State;
  description?: string | null;
  details: string;
  error?: string | null;
  children?: ReactNode;
}) {
  const badge = BADGES[state];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>{title}</CardTitle>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-secondary-foreground text-sm font-light">{details}</p>
          {error && <p className="text-destructive dark:text-error text-sm">{error}</p>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </CardContent>
    </Card>
  );
}

function Unavailable({ children }: { children: ReactNode }) {
  return <p className="text-secondary-foreground text-sm font-light">{children}</p>;
}

export default async function ConnectorsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const { workspace, member } = await requireMember(slug, `/w/${slug}/connectors`);
  const isAdmin = member.role === "Admin";

  const [github, slackStored, planeStored, slack, plane, counts] = await Promise.all([
    githubConnection(slug),
    getConnector(slug, "slack"),
    getConnector(slug, "plane"),
    resolveSlack(slug).catch(() => null),
    resolvePlane(slug).catch(() => null),
    sourceCounts(slug),
  ]);
  const canStore = encryptionConfigured();

  const githubState = stateOf(Boolean(github && github.status !== "disconnected"), github?.status);
  const slackState = stateOf(Boolean(slack), slackStored?.status, slackStored?.sync_started_at ?? null);
  const planeState = stateOf(Boolean(plane), planeStored?.status, planeStored?.sync_started_at ?? null);
  const syncing = [githubState, slackState, planeState].includes("syncing");

  const actions = (key: ConnectorKey, title: string, connected: boolean, stored: boolean) =>
    isAdmin && connected && <ConnectorActions slug={slug} connector={key} title={title} canSync canDisconnect={stored} />;

  return (
    <>
      <PageHeader title="Connectors" description={workspace.name} />
      <RefreshWhileSyncing active={syncing} />
      <div className="flex flex-col gap-4">
        <ConnectorCard
          title="GitHub"
          state={githubState}
          description={github?.repo}
          details={syncedLine(github?.synced_at, counts.github ?? 0)}
          error={githubState === "error" ? "The last sync failed." : null}
        >
          {isAdmin &&
            (githubAppConfigured() ? (
              <Button variant={github ? "secondary" : "brand"} shape="pill" asChild>
                <a href={installUrl(slug)}>{github ? "Manage repositories" : "Connect GitHub"}</a>
              </Button>
            ) : (
              <Unavailable>GitHub app is not configured on this server.</Unavailable>
            ))}
          {actions("github", "GitHub", githubState !== "not_connected", true)}
        </ConnectorCard>

        <ConnectorCard
          title="Slack"
          state={slackState}
          description={slack?.fromEnv ? "Configured by server environment" : slackStored?.label}
          details={syncedLine(slackStored?.synced_at, counts.slack ?? 0)}
          error={errorLine(slackState, slackStored)}
        >
          {isAdmin &&
            (slackAppConfigured() && canStore ? (
              <Button variant={slack ? "secondary" : "brand"} shape="pill" asChild>
                <a href={slackInstallUrl(slug)}>{slack && !slack.fromEnv ? "Reinstall Slack" : "Add to Slack"}</a>
              </Button>
            ) : (
              !slack && <Unavailable>Slack app is not configured on this server.</Unavailable>
            ))}
          {actions("slack", "Slack", Boolean(slack), Boolean(slack && !slack.fromEnv))}
        </ConnectorCard>

        <ConnectorCard
          title="Plane"
          state={planeState}
          description={plane?.fromEnv ? "Configured by server environment" : planeStored?.label}
          details={syncedLine(planeStored?.synced_at, counts.plane ?? 0)}
          error={errorLine(planeState, planeStored)}
        >
          {isAdmin && (!plane || plane.fromEnv) && (canStore ? <PlaneConnectForm slug={slug} /> : <Unavailable>Connector storage is not configured on this server.</Unavailable>)}
          {isAdmin && plane && !plane.fromEnv && !planeStored?.has_webhook_secret && (
            <PlaneWebhookForm slug={slug} webhookUrl={planeWebhookUrl(slug)} />
          )}
          {actions("plane", "Plane", Boolean(plane), Boolean(plane && !plane.fromEnv))}
        </ConnectorCard>
      </div>
    </>
  );
}
