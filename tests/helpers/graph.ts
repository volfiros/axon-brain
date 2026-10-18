import { after } from "node:test";

import { FalkorDB } from "falkordb";

import { closeConnection } from "@/lib/graph/client";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function falkorSocket() {
  return { host: process.env.FALKORDB_HOST || "localhost", port: Number(process.env.FALKORDB_PORT || 6379) };
}

/**
 * Checks that this test process runs against a local FalkorDB under its own prefix, and deletes its graphs afterwards.
 * Call it once at the top of every integration test file.
 */
export function useTestGraphs(): { prefix: string } {
  const prefix = process.env.FALKORDB_GRAPH_PREFIX ?? "";
  if (!prefix.startsWith("axontest_")) throw new Error("Run integration tests with npm run test:integration");
  // Integration tests write and delete graphs, so they refuse to run against anything but a local database.
  if (!LOCAL_HOSTS.has(falkorSocket().host)) {
    throw new Error(`Integration tests only run against a local FalkorDB, not ${falkorSocket().host}`);
  }
  after(async () => {
    await closeConnection();
    const db = await FalkorDB.connect({ socket: falkorSocket() });
    try {
      for (const name of await db.list()) {
        if (name.startsWith(`${prefix}_`)) await db.selectGraph(name).delete();
      }
    } finally {
      await db.close();
    }
  });
  return { prefix };
}
