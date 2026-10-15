import type { NavItem } from "@/components/nav-tabs";

export function workspaceNav(slug: string): NavItem[] {
  return [
    { href: "/onboarding", label: "Workspaces" },
    { href: `/w/${slug}/setup`, label: "Setup" },
    { href: `/w/${slug}/members`, label: "Members" },
  ];
}
