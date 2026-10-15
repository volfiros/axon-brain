"use client";

import { ErrorState } from "@/components/error-state";
import { PageShell } from "@/components/page-shell";

export default function ErrorPage(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageShell>
      <ErrorState {...props} />
    </PageShell>
  );
}
