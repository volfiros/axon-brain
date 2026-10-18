import { WaypointsIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireMember } from "@/lib/auth/session";
import { graphView } from "@/lib/brain/graph-view";
import { memberContext } from "@/lib/brain/overview";

import { GraphExplorer } from "./graph-explorer";

export default async function GraphPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const { member } = await requireMember(slug, `/w/${slug}/graph`);
  const view = await graphView(memberContext(slug, member));

  return (
    <>
      <PageHeader
        title="Graph"
        description={view.capped ? `Showing ${view.nodes.length} of ${view.total} nodes you can see` : undefined}
      />
      {view.nodes.length === 0 ? (
        <EmptyState icon={<WaypointsIcon />} title="Nothing in the graph yet" description="Save a decision from Claude Code with the save tool." />
      ) : (
        <GraphExplorer slug={slug} view={view} />
      )}
    </>
  );
}
