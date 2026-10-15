import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      {icon && <div className="text-secondary-foreground [&_svg]:size-5">{icon}</div>}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-light">{title}</h2>
        {description && <p className="text-secondary-foreground max-w-sm text-sm font-light">{description}</p>}
      </div>
      {action}
    </div>
  );
}
