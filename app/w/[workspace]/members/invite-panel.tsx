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

  function create() {
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
        {link ? (
          <ConfirmButton
            label={`Replace ${role} link`}
            title={`Replace the ${role} invite link?`}
            description="The current link stops working right away. People who already joined stay."
            confirmLabel="Replace"
            onConfirm={() => newInviteAction(slug, role)}
          />
        ) : (
          <Button variant="secondary" shape="pill" onClick={create} loading={pending}>
            {`Create ${role} link`}
          </Button>
        )}
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
