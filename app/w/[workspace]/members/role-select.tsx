"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLES, type Role } from "@/lib/roles";

import { changeRoleAction } from "./actions";

export function RoleSelect({ slug, personId, role }: { slug: string; personId: string; role: Role }) {
  const [value, setValue] = useState(role);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const previous = value;
    setValue(next as Role);
    startTransition(async () => {
      const { error } = await changeRoleAction(slug, personId, next as Role);
      if (error) {
        setValue(previous);
        toast.error(error);
      }
    });
  }

  return (
    <Select value={value} onValueChange={change} disabled={pending}>
      <SelectTrigger className="w-32" aria-label="Role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {r}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
