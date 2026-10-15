"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";

export type NavItem = { href: string; label: string };

export function NavTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto md:gap-2">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Button
            key={item.href}
            variant={active ? "tabActive" : "tab"}
            size="lg"
            shape="pill"
            className="px-4 md:px-6"
            asChild
          >
            <Link href={item.href} aria-current={active ? "page" : undefined}>
              {item.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
