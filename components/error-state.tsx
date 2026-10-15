"use client";

import { TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export function ErrorState({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // reset() alone re-renders the cached server output, so refresh first to run the failed server component again.
  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <EmptyState
      icon={<TriangleAlertIcon />}
      title="This page could not load"
      description={error.digest ? `Something went wrong on our side. Error ${error.digest}.` : "Something went wrong."}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" shape="pill" loading={pending} onClick={retry}>
            Try again
          </Button>
          <Button variant="tab" shape="pill" asChild>
            <Link href="/onboarding">Back to workspaces</Link>
          </Button>
        </div>
      }
    />
  );
}
