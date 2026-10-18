import type { ComponentProps, ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export function FormField({
  label,
  id,
  type,
  hint,
  ...props
}: { label: string; id: string; hint?: ReactNode } & Omit<ComponentProps<typeof Input>, "variant">) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-secondary-foreground text-xs font-light">
        {label}
      </Label>
      {type === "password" ? (
        <PasswordInput id={id} name={id} aria-describedby={hintId} {...props} />
      ) : (
        <Input id={id} name={id} type={type} variant="field" aria-describedby={hintId} {...props} />
      )}
      {hint && (
        <p id={hintId} className="text-secondary-foreground text-xs font-light break-all">
          {hint}
        </p>
      )}
    </div>
  );
}
