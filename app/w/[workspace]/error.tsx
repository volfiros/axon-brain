"use client";

import { ErrorState } from "@/components/error-state";

export default function WorkspaceError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState {...props} />;
}
