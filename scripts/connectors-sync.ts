import { join } from "node:path";

import { fixturePlaneApi } from "@/lib/connectors/plane/api";
import { backfillWith as planeBackfill, planeConnector } from "@/lib/connectors/plane";
import { fixtureSlackApi } from "@/lib/connectors/slack/api";
import { backfillWith as slackBackfill, slackConnector } from "@/lib/connectors/slack";
import type { Batch, ConnectorContext } from "@/lib/connectors/types";
import { writeBatch } from "@/lib/connectors/write";
import { closeConnection, workspaceGraph } from "@/lib/graph/client";

const FIXTURES = join(__dirname, "..", "demo", "connectors");
const FIXTURE_PLANE_LINKS = { appUrl: "https://app.plane.so", workspaceSlug: "tallyroll" };

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

function batches(connector: string, fixtures: boolean, ctx: ConnectorContext): AsyncIterable<Batch> {
  if (connector === "plane") {
    return fixtures ? planeBackfill(fixturePlaneApi(join(FIXTURES, "plane", "api.json")), ctx, FIXTURE_PLANE_LINKS) : planeConnector.backfill(ctx);
  }
  if (connector === "slack") {
    return fixtures ? slackBackfill(fixtureSlackApi(join(FIXTURES, "slack", "api.json")), ctx) : slackConnector.backfill(ctx);
  }
  throw new Error("Usage: npm run connectors:sync -- <plane|slack> [--fixtures] [--workspace <slug>]");
}

async function main() {
  const connector = process.argv[2];
  const fixtures = process.argv.includes("--fixtures");
  const workspace = option("--workspace") ?? process.env.CONNECTORS_WORKSPACE ?? "demo";
  const graph = workspaceGraph(workspace);

  const [roles] = await graph.roQuery<{ n: number }>("MATCH (r:Role) RETURN count(r) AS n");
  if (!roles?.n) console.warn(`${graph.name} has no Role nodes, so no VISIBLE_TO edges will be written.`);

  let sources = 0;
  for await (const batch of batches(connector, fixtures, { workspace, graph })) {
    await writeBatch(graph, batch);
    sources += batch.sources?.length ?? 0;
  }
  console.log(`Synced ${connector}${fixtures ? " fixtures" : ""} into ${graph.name}: ${sources} sources`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeConnection);
