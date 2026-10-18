import type { ReactNode } from "react";

export function SheetField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-surface text-surface-foreground flex flex-col gap-1.5 rounded-xl p-3 text-sm">
      <span className="text-secondary-foreground text-xs font-light">{label}</span>
      {children}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <span className="text-secondary-foreground font-light">{children}</span>;
}

export function SourceLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="decoration-muted-foreground hover:decoration-foreground underline underline-offset-4">
      {children}
    </a>
  );
}

export function DecidedFields({
  maker,
  approver,
  date,
  replaced,
}: {
  maker: string | null;
  approver: string | null;
  date: string;
  replaced: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <SheetField label="Decided by">
        <span>{maker ?? "Unknown"}</span>
      </SheetField>
      <SheetField label="Date">
        <span>{date}</span>
      </SheetField>
      {approver && (
        <SheetField label="Approved by">
          <span>{approver}</span>
        </SheetField>
      )}
      {replaced && (
        <SheetField label="Replaced">
          <span>{replaced}</span>
        </SheetField>
      )}
    </div>
  );
}
