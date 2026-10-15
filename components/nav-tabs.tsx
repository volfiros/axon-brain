"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";

export type NavItem = { href: string; label: string };

export function NavTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex w-full min-w-0 items-center justify-between overflow-x-auto md:w-auto md:justify-start md:gap-2">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Button
            key={item.href}
            variant={active ? "tertiary" : "secondaryTab"}
            size="lg"
            shape="pill"
            className="h-9 px-2 text-xs md:h-10 md:px-6 md:text-sm"
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
