"use client";

import { TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageShell>
      <EmptyState
        icon={<TriangleAlertIcon />}
        title="This page could not load"
        description={error.digest ? `Something went wrong on our side. Error ${error.digest}.` : "Something went wrong."}
        action={
          <Button variant="outline" shape="pill" onClick={reset}>
            Try again
          </Button>
        }
      />
    </PageShell>
  );
}
