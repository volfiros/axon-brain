import type { AxonGraph } from "@/lib/graph/client";
import type { Batch, PersonRef, SourceInput } from "@/lib/connectors/types";

export const slackUser: PersonRef = { connector: "slack", external_id: "U100", name: "Sam Slack" };

/** A Slack message Batch with its author, as the Slack connector would hand to writeBatch. */
export function slackMessage(ts: string, text: string, extra: Partial<SourceInput> = {}): Batch {
  const source: SourceInput = {
    connector: "slack",
    external_id: `C100:${ts}`,
    labels: ["Message"],
    title: `Message in #payments`,
    text,
    url: `https://acme.slack.com/archives/C100/p${ts.replace(".", "")}`,
    created_at: "2026-10-01T09:00:00Z",
    sensitivity: "team",
    ...extra,
  };
  return {
    sources: [source],
    people: [slackUser],
    links: [
      {
        from: { kind: "person", connector: slackUser.connector, external_id: slackUser.external_id },
        rel: "AUTHORED",
        to: { kind: "source", connector: "slack", external_id: source.external_id },
      },
    ],
  };
}

export async function contentHash(graph: AxonGraph, sourceId: string): Promise<string> {
  const [row] = await graph.query<{ hash: string }>("MATCH (s:Source {id: $id}) RETURN s.content_hash AS hash", { id: sourceId });
  return row.hash;
}
