"use client";

import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type WorkspaceLink = { slug: string; name: string };

export function WorkspaceSwitcher({ current, workspaces }: { current: WorkspaceLink; workspaces: WorkspaceLink[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondaryTab" size="lg" shape="pill" className="max-w-56 px-4">
          <span className="truncate">{current.name}</span>
          <ChevronsUpDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.slug} asChild>
            <Link href={`/w/${workspace.slug}`}>
              <span className="flex-1 truncate">{workspace.name}</span>
              {workspace.slug === current.slug && <CheckIcon />}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <PlusIcon />
            Create or join a workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
