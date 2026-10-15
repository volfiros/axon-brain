"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { CodeSnippet } from "@/components/code-snippet";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";

import { newInviteAction, revokeInviteAction } from "./actions";

export function InvitePanel({ slug, link }: { slug: string; link: string | null }) {
  const [pending, startTransition] = useTransition();

  function regenerate() {
    startTransition(async () => {
      const { error } = await newInviteAction(slug);
      if (error) toast.error(error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {link && <CodeSnippet code={link} label="invite link" />}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" shape="pill" onClick={regenerate} disabled={pending}>
          {link ? "Replace invite link" : "Create invite link"}
        </Button>
        {link && (
          <ConfirmButton
            label="Revoke invite link"
            title="Revoke this invite link?"
            description="The link stops working right away. People who already joined stay."
            confirmLabel="Revoke"
            onConfirm={() => revokeInviteAction(slug)}
          />
        )}
      </div>
    </div>
  );
}
