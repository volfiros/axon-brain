"use client";

import { useActionState } from "react";

import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";

import { joinWorkspaceAction } from "@/app/onboarding/actions";

export function JoinButton({ code }: { code: string }) {
  const [state, action, pending] = useActionState(joinWorkspaceAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="code" value={code} />
      <FormError message={state.error} />
      <Button type="submit" size="lg" shape="pill" disabled={pending}>
        {pending ? "Joining" : "Join workspace"}
      </Button>
    </form>
  );
}
