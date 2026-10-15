import type { NavItem } from "@/components/nav-tabs";

export function workspaceNav(slug: string): NavItem[] {
  return [
    { href: `/w/${slug}`, label: "Home" },
    { href: `/w/${slug}/people`, label: "People" },
    { href: `/w/${slug}/members`, label: "Members" },
    { href: `/w/${slug}/setup`, label: "Setup" },
  ];
}
