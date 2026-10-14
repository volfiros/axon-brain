import { closeConnection, listWorkspaceSlugs, workspaceGraph } from "@/lib/graph/client";
import { ensureWorkspaceSchema } from "@/lib/graph/schema";

async function main() {
  const slugs = process.argv[2] ? [process.argv[2]] : await listWorkspaceSlugs();
  if (slugs.length === 0) {
    console.log("No workspace graphs found. Run npm run db:seed to create the demo workspace.");
  }
  for (const slug of slugs) {
    const graph = workspaceGraph(slug);
    await ensureWorkspaceSchema(graph);
    console.log(`Schema ready: ${graph.name}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeConnection);
