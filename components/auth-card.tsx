import type { ReactNode } from "react";

export function AuthCard({
  title,
  description,
  footer,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-light tracking-tight">{title}</h1>
        {description && <p className="text-secondary-foreground text-sm font-light">{description}</p>}
      </div>
      {children && <div className="flex flex-col gap-4">{children}</div>}
      {footer && <div className="text-secondary-foreground text-sm font-light">{footer}</div>}
    </div>
  );
}
