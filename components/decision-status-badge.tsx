import { LockIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";

export const DECISION_STATES = ["proposed", "accepted", "superseded", "restricted", "changed", "current", "stale"] as const;

export type DecisionState = (typeof DECISION_STATES)[number];

const STATE_BADGES: Record<DecisionState, { label: string; variant: ComponentProps<typeof Badge>["variant"] }> = {
  proposed: { label: "Proposed", variant: "outline" },
  accepted: { label: "Accepted", variant: "valid" },
  superseded: { label: "Superseded", variant: "muted" },
  restricted: { label: "Restricted", variant: "warning" },
  changed: { label: "Source changed", variant: "warning" },
  current: { label: "Current", variant: "valid" },
  stale: { label: "Stale", variant: "warning" },
};

/** `current` and `stale` are saved answer statuses. `restricted` and `changed` are not statuses: render them next to the status badge when they apply. */
export function DecisionStatusBadge({ status }: { status: DecisionState }) {
  const { label, variant } = STATE_BADGES[status];
  return (
    <Badge variant={variant}>
      {status === "restricted" && <LockIcon />}
      {label}
    </Badge>
  );
}
