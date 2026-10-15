"use client";

import { useState } from "react";

import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { authClient, followAuthRedirect } from "@/lib/auth/client";

export function ConsentButtons({ allowAccept }: { allowAccept: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);

  async function answer(accept: boolean) {
    setPending(accept ? "allow" : "deny");
    setError(null);
    const { data, error } = await authClient.oauth2.consent({ accept });
    if (error || !followAuthRedirect(data)) {
      setError(error?.message ?? "Could not finish the request.");
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="lg" shape="pill" disabled={pending !== null} loading={pending === "deny"} onClick={() => answer(false)}>
          Deny
        </Button>
        {allowAccept && (
          <Button variant="brand" size="lg" shape="pill" disabled={pending !== null} loading={pending === "allow"} onClick={() => answer(true)}>
            Allow
          </Button>
        )}
      </div>
    </div>
  );
}
