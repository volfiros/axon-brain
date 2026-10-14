"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { CodeSnippet } from "@/components/code-snippet";
import { Button } from "@/components/ui/button";

import { newInviteAction } from "./actions";

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
      <div>
        <Button variant="outline" onClick={regenerate} disabled={pending}>
          {link ? "Replace invite link" : "Create invite link"}
        </Button>
      </div>
    </div>
  );
}
