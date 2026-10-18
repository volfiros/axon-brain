import { randomUUID } from "node:crypto";
import { after, before } from "node:test";

import { FalkorDB } from "falkordb";

import { closeConnection } from "@/lib/graph/client";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function falkorSocket() {
  return { host: process.env.FALKORDB_HOST || "localhost", port: Number(process.env.FALKORDB_PORT || 6379) };
}

/**
 * Gives one test file its own graph prefix on a local FalkorDB and deletes every graph it created afterwards.
 * Call it at the top of an integration test file, before using any graph.
 */
export function useTestGraphs(): { prefix: string } {
  const prefix = `axontest_${randomUUID().slice(0, 8)}`;
  // Integration tests write and delete graphs, so they refuse to run against anything but a local database.
  if (!LOCAL_HOSTS.has(falkorSocket().host)) {
    throw new Error(`Integration tests only run against a local FalkorDB, not ${falkorSocket().host}`);
  }
  before(() => {
    process.env.FALKORDB_GRAPH_PREFIX = prefix;
  });
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
