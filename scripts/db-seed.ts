import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closeConnection, workspaceGraph } from "@/lib/graph/client";
import { ensureWorkspaceSchema } from "@/lib/graph/schema";

const DEMO_SLUG = "demo";

function seedStatements(): string[] {
  const source = readFileSync(join(__dirname, "seed", "demo.cypher"), "utf8");
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  const graph = workspaceGraph(DEMO_SLUG);
  await graph.query("MATCH (n) DETACH DELETE n");
  await ensureWorkspaceSchema(graph);
  for (const statement of seedStatements()) {
    await graph.query(statement);
  }
  const [counts] = await graph.roQuery<{ nodes: number; edges: number }>(
    "MATCH (n) WITH count(n) AS nodes MATCH ()-[r]->() RETURN nodes, count(r) AS edges",
  );
  console.log(`Seeded ${graph.name}: ${counts.nodes} nodes, ${counts.edges} relationships`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeConnection);
