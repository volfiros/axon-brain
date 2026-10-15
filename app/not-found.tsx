import { CompassIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { getAccount } from "@/lib/auth/session";

export default async function NotFound() {
  const account = await getAccount().catch(() => null);
  return (
    <PageShell account={account ?? undefined}>
      <EmptyState
        icon={<CompassIcon />}
        title="Page not found"
        description="This page does not exist, or you are not a member of this workspace."
        action={
          <Button variant="secondary" shape="pill" asChild>
            <Link href="/onboarding">Back to workspaces</Link>
          </Button>
        }
      />
    </PageShell>
  );
}
