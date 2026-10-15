import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ReactNode } from "react";

import { AccountMenu, type AccountSummary } from "@/components/account-menu";
import { type NavItem, NavTabs } from "@/components/nav-tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { type WorkspaceLink, WorkspaceSwitcher } from "@/components/workspace-switcher";

const windowVariants = cva("flex flex-1 flex-col", {
  variants: {
    width: {
      default: "bg-linear-to-b from-background to-surface",
      narrow: "",
    },
  },
  defaultVariants: { width: "default" },
});

const contentVariants = cva("mx-auto flex w-full flex-1 flex-col gap-8 px-2", {
  variants: {
    width: {
      default: "max-w-7xl pt-8 pb-16 lg:px-8 lg:pt-12",
      narrow: "max-w-sm justify-center py-16",
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
  account?: AccountSummary;
  workspace?: { current: WorkspaceLink; all: WorkspaceLink[] };
  children: ReactNode;
} & VariantProps<typeof contentVariants>) {
  return (
    <div className="bg-background flex min-h-dvh flex-col px-3 pt-16 pb-3">
      <header className="bg-surface text-surface-foreground fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between gap-4 px-5">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="text-xl font-light tracking-tight">
            Axon
          </Link>
          {workspace && <WorkspaceSwitcher current={workspace.current} workspaces={workspace.all} />}
          {nav && <NavTabs items={nav} />}
        </div>
        <div className="flex items-center gap-2">{account ? <AccountMenu account={account} /> : <ThemeToggle />}</div>
      </header>
      <div aria-hidden className="app-frame pointer-events-none fixed inset-x-3 top-16 bottom-3 z-40 rounded-xl" />
      <main className={windowVariants({ width })}>
        <div className={contentVariants({ width })}>{children}</div>
      </main>
    </div>
  );
}
