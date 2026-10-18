"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { CodeSnippet } from "@/components/code-snippet";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import type { InviteRole } from "@/lib/workspaces";

import { newInviteAction, revokeInviteAction } from "./actions";

export function InvitePanel({ slug, role, link }: { slug: string; role: InviteRole; link: string | null }) {
  const [pending, startTransition] = useTransition();

  function regenerate() {
    startTransition(async () => {
      const { error } = await newInviteAction(slug, role);
      if (error) toast.error(error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{role} link</p>
      {link && <CodeSnippet code={link} label={`${role} invite link`} />}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" shape="pill" onClick={regenerate} loading={pending}>
          {link ? `Replace ${role} link` : `Create ${role} link`}
        </Button>
        {link && (
          <ConfirmButton
            label={`Revoke ${role} link`}
            title={`Revoke the ${role} invite link?`}
            description="The link stops working right away. People who already joined stay."
            confirmLabel="Revoke"
            onConfirm={() => revokeInviteAction(slug, role)}
          />
        )}
      </div>
    </div>
  );
}
