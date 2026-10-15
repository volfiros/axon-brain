"use client";

import { BuildingIcon, LogOutIcon, MoonIcon, SettingsIcon, SunIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/client";

export type AccountSummary = { name: string; username?: string | null };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function AccountMenu({ account }: { account: AccountSummary }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondaryTab" size="icon" shape="pill" aria-label="Account menu">
          <Avatar className="size-8">
            <AvatarFallback className="bg-secondary text-secondary-foreground text-xs font-light">{initials(account.name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-light">
          <span className="truncate">{account.name}</span>
          {account.username && <span className="text-secondary-foreground truncate text-xs">{account.username}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <BuildingIcon />
            Workspaces
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account">
            <SettingsIcon />
            Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          <SunIcon className="hidden dark:block" />
          <MoonIcon className="dark:hidden" />
          {resolvedTheme === "dark" ? "Light theme" : "Dark theme"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
