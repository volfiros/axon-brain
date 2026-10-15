import { NetworkIcon } from "lucide-react";

import { DECISION_STATES, DecisionStatusBadge } from "@/components/decision-status-badge";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <PageShell>
      <PageHeader
        title="Home"
        actions={
          <Button variant="outline" shape="pill" asChild>
            <a href="/api/health">Check the graph connection</a>
          </Button>
        }
      />
      <EmptyState
        icon={<NetworkIcon />}
        title="No workspace yet"
        description="Sign-in and workspace setup are coming next. Your team's decisions will show up here."
      />
      <Card>
        <CardHeader>
          <CardTitle>Decision states</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {DECISION_STATES.map((state) => (
            <DecisionStatusBadge key={state} status={state} />
          ))}
        </CardContent>
      </Card>
    </PageShell>
  );
}
