import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export function FormField({
  label,
  id,
  type,
  ...props
}: { label: string; id: string } & Omit<ComponentProps<typeof Input>, "variant">) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-secondary-foreground text-xs font-light">
        {label}
      </Label>
      {type === "password" ? (
        <PasswordInput id={id} name={id} {...props} />
      ) : (
        <Input id={id} name={id} type={type} variant="field" {...props} />
      )}
    </div>
  );
}
