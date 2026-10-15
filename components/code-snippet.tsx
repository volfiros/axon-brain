"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function CodeSnippet({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-surface text-surface-foreground relative rounded-2xl">
      <Button
        variant="tab"
        size="icon"
        shape="pill"
        className="absolute top-2 right-2"
        onClick={copy}
        aria-label={copied ? "Copied" : `Copy ${label ?? "code"}`}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <pre className="overflow-x-auto p-4 pr-14 font-mono text-sm">
        <code>{code}</code>
      </pre>
    </div>
  );
}
