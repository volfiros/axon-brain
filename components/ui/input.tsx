import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const inputVariants = cva(
  "file:text-foreground placeholder:text-muted-foreground selection:text-primary-foreground flex w-full min-w-0 text-base outline-none ring-0 transition-[color,background-color,box-shadow] duration-200 selection:bg-blue-400 file:inline-flex file:h-7 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
  {
    variants: {
      variant: {
        default: "shadow-xs h-9 rounded-md border-none bg-transparent px-3 py-1",
        field:
          "bg-surface-active text-surface-foreground hover:bg-surface-hover focus-visible:ring-ring/20 h-10 rounded-lg border border-border px-3 font-light focus-visible:ring-4 dark:border-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Input({ className, type, variant, ...props }: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return <input type={type} data-slot="input" className={cn(inputVariants({ variant }), className)} {...props} />;
}

export { Input, inputVariants };
