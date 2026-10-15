import { cva, type VariantProps } from "class-variance-authority";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { AccountMenu, type AccountSummary } from "@/components/account-menu";
import { type NavItem, NavTabs } from "@/components/nav-tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { type WorkspaceLink, WorkspaceSwitcher } from "@/components/workspace-switcher";
import { cn } from "@/lib/utils";

const contentVariants = cva("mx-auto flex w-full flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:px-2 md:py-6", {
  variants: {
    width: {
      default: "max-w-7xl lg:px-8 lg:py-8",
      narrow: "max-w-sm justify-center",
    },
  },
  defaultVariants: { width: "default" },
});

export function PageShell({
  nav,
  account,
  workspace,
  width,
  children,
}: {
  nav?: NavItem[];
  account?: AccountSummary | "loading";
  workspace?: { current: WorkspaceLink; all: WorkspaceLink[] };
  children: ReactNode;
} & VariantProps<typeof contentVariants>) {
  return (
    <div className={cn("bg-background flex min-h-dvh flex-col md:px-3 md:pb-3", nav ? "pt-28 md:pt-16" : "pt-16")}>
      <header className="bg-primary text-primary-foreground fixed inset-x-0 top-0 z-50 flex flex-wrap items-center gap-x-4 px-3 md:px-5">
        <div className="flex h-16 min-w-0 items-center gap-4">
          <Link href="/" className="shrink-0">
            <Image src="/axon-wordmark.svg" alt="Axon" width={84} height={20} priority />
          </Link>
          {workspace && <WorkspaceSwitcher current={workspace.current} workspaces={workspace.all} />}
        </div>
        {nav && (
          <div className="order-last flex h-12 w-full min-w-0 items-start md:order-none md:h-16 md:w-auto md:flex-1 md:items-center">
            <NavTabs items={nav} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {account === "loading" ? (
            <Skeleton className="bg-secondary size-9 rounded-full" />
          ) : account ? (
            <AccountMenu account={account} />
          ) : (
            <ThemeToggle />
          )}
        </div>
      </header>
      <div
        aria-hidden
        className={cn("app-frame pointer-events-none fixed inset-x-3 bottom-3 z-40 hidden rounded-xl md:block", nav ? "top-28 md:top-16" : "top-16")}
      />
      <main className="flex flex-1 flex-col">
        <div className={contentVariants({ width })}>{children}</div>
      </main>
    </div>
  );
}
