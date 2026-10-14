import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import type { Role } from "@/lib/roles";

const ROLE_VARIANTS: Record<Role, ComponentProps<typeof Badge>["variant"]> = {
  Admin: "outline",
  Member: "secondary",
  Guest: "muted",
};

export function RoleBadge({ role }: { role: Role }) {
  return <Badge variant={ROLE_VARIANTS[role]}>{role}</Badge>;
}
