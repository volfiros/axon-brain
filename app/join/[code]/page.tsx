import { AuthCard } from "@/components/auth-card";
import { PageShell } from "@/components/page-shell";
import { TextLink } from "@/components/text-link";
import { requireAccount } from "@/lib/auth/session";
import { findInvite } from "@/lib/workspaces";

import { JoinButton } from "./join-button";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  await requireAccount(`/join/${encodeURIComponent(code)}`);
  const workspace = await findInvite(code);

  return (
    <PageShell width="narrow">
      {workspace ? (
        <AuthCard title={`Join ${workspace.name}`} description="You join as a Guest. An Admin can change your role later.">
          <JoinButton code={code} />
        </AuthCard>
      ) : (
        <AuthCard
          title="This invite does not work"
          description="The link is wrong or has expired. Ask an Admin for a new one."
          footer={<TextLink href="/onboarding">Back to workspaces</TextLink>}
        />
      )}
    </PageShell>
  );
}
