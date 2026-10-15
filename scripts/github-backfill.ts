import { connectInstallation, syncInstallation } from "@/lib/connectors/github/connection";
import { closeConnection, workspaceGraph } from "@/lib/graph/client";

async function main() {
  const [slug, installation, since] = process.argv.slice(2);
  const installationId = Number(installation);
  if (!slug || !Number.isInteger(installationId)) {
    throw new Error("Usage: npm run github:backfill -- <workspace-slug> <installation-id> [since-iso-date]");
  }
  const repos = await connectInstallation(slug, installationId);
  console.log(`Connected installation ${installationId} to ${slug}: ${repos.join(", ")}`);
  const batches = await syncInstallation(slug, installationId, since);
  const [counts] = await workspaceGraph(slug).roQuery<{ sources: number; people: number; files: number }>(
    `MATCH (s:Source {connector: 'github'}) WITH count(s) AS sources
     MATCH (p:Person) WITH sources, count(p) AS people
     MATCH (c:CodeUnit {kind: 'file'}) RETURN sources, people, count(c) AS files`,
  );
  console.log(`Wrote ${batches} batches: ${counts.sources} sources, ${counts.people} people, ${counts.files} files`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeConnection);
