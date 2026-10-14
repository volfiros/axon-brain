import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const CONTENT_WIDTH = "mx-auto w-full max-w-5xl px-4";

export function PageShell({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className={cn(CONTENT_WIDTH, "flex h-14 items-center justify-between")}>
          <Link href="/" className="font-semibold">
            Axon
          </Link>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </header>
      <main className={cn(CONTENT_WIDTH, "flex flex-1 flex-col gap-8 py-8")}>{children}</main>
    </div>
  );
}
