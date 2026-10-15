import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const tableVariants = cva("w-full caption-bottom text-sm", {
  variants: {
    variant: {
      default: "",
      rows: [
        "border-separate border-spacing-y-3 text-surface-foreground",
        "[&_tr]:bg-surface [&_tbody_tr:hover]:bg-surface-hover",
        "[&_th]:text-secondary-foreground [&_th]:text-xs [&_th]:font-light",
        "[&_td]:py-3 [&_tr>*:first-child]:rounded-l-lg [&_tr>*:first-child]:pl-4 [&_tr>*:last-child]:rounded-r-lg [&_tr>*:last-child]:pr-4",
      ],
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

function Table({ className, variant, ...props }: React.ComponentProps<"table"> & VariantProps<typeof tableVariants>) {
  return (
    <div className="relative w-full overflow-auto">
      <table data-slot="table" className={cn(tableVariants({ variant }), className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={className} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot data-slot="table-footer" className={cn("bg-muted/50 font-medium", className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn("hover:bg-muted/50 data-[state=selected]:bg-muted transition-colors", className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-muted-foreground h-10 px-2 text-left align-middle font-medium [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "text-nowrap p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption data-slot="table-caption" className={cn("text-muted-foreground mt-4 text-sm", className)} {...props} />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
