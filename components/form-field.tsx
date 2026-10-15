import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FormField({
  label,
  id,
  className,
  ...props
}: { label: string; id: string } & ComponentProps<typeof Input>) {
  return (
    <div className="bg-surface text-surface-foreground hover:bg-surface-hover focus-within:bg-surface-hover focus-within:ring-ring/20 flex flex-col gap-2 rounded-2xl p-4 transition-colors duration-200 focus-within:ring-4">
      <Label htmlFor={id} className="text-secondary-foreground text-xs font-light">
        {label}
      </Label>
      <Input id={id} name={id} className={cn("h-auto p-0 shadow-none", className)} {...props} />
    </div>
  );
}
