import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth-card";
import { PageShell } from "@/components/page-shell";
import { appUrl, auth } from "@/lib/auth";
import { getMember, getWorkspace } from "@/lib/workspaces";

import { ConsentButtons } from "./consent-buttons";

type Search = Record<string, string | string[] | undefined>;

function workspaceSlug(resource: string | undefined): string | null {
  const match = resource?.startsWith(`${appUrl}/w/`) ? /^\/w\/([a-z0-9-]+)\/mcp$/.exec(resource.slice(appUrl.length)) : null;
  return match?.[1] ?? null;
}

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const query = new URLSearchParams(
    Object.entries(search).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  ).toString();
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect(`/sign-in?${query}`);

  const clientId = typeof search.client_id === "string" ? search.client_id : "";
  const client = clientId
    ? await auth.api.getOAuthClientPublic({ query: { client_id: clientId }, headers: requestHeaders }).catch(() => null)
    : null;
  const clientName = client?.client_name || "An application";

  const slug = workspaceSlug(typeof search.resource === "string" ? search.resource : undefined);
  const workspace = slug ? await getWorkspace(slug) : null;
  const member = workspace ? await getMember(workspace.slug, session.user.id) : null;

  if (workspace && !member) {
    return (
      <PageShell width="narrow" account={{ name: session.user.name }}>
        <AuthCard
          title="You are not in this workspace"
          description={`${clientName} asked for access to ${workspace.name}, but your account is not a member. Ask an Admin there for an invite.`}
        >
          <ConsentButtons allowAccept={false} />
        </AuthCard>
      </PageShell>
    );
  }

  return (
    <PageShell width="narrow" account={{ name: session.user.name }}>
      <AuthCard
        title={`Allow ${clientName} to use Axon?`}
        description={
          workspace
            ? `It will read ${workspace.name} as ${session.user.name} with the ${member?.role} role.`
            : `It will act as ${session.user.name}.`
        }
      >
        <ConsentButtons allowAccept />
      </AuthCard>
    </PageShell>
  );
}
