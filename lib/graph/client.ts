import { FalkorDB, type Graph } from "falkordb";

export type Params = NonNullable<NonNullable<Parameters<Graph["query"]>[1]>["params"]>;
export type Row = Record<string, unknown>;

export type AxonGraph = {
  name: string;
  query<T = Row>(cypher: string, params?: Params): Promise<T[]>;
  roQuery<T = Row>(cypher: string, params?: Params): Promise<T[]>;
};

const ACCOUNTS = "accounts";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Cached on globalThis so Next.js dev reloads and warm serverless calls reuse one connection.
const cache = globalThis as typeof globalThis & { axonFalkor?: Promise<FalkorDB> };

function connect(): Promise<FalkorDB> {
  cache.axonFalkor ??= FalkorDB.connect({
    socket: {
      host: process.env.FALKORDB_HOST || "localhost",
      port: Number(process.env.FALKORDB_PORT || 6379),
    },
    username: process.env.FALKORDB_USERNAME || undefined,
    password: process.env.FALKORDB_PASSWORD || undefined,
  }).then(
    (db) => {
      // Without a listener, a dropped connection emits an unhandled 'error' and kills the process.
      db.on("error", (err) => console.error("FalkorDB connection error:", err));
      return db;
    },
    (err) => {
      cache.axonFalkor = undefined;
      throw err;
    },
  );
  return cache.axonFalkor;
}

function prefix(): string {
  return process.env.FALKORDB_GRAPH_PREFIX || "axon";
}

function openGraph(name: string): AxonGraph {
  return {
    name,
    async query<T = Row>(cypher: string, params?: Params) {
      const reply = await (await connect()).selectGraph(name).query<T>(cypher, { params });
      return reply.data ?? [];
    },
    async roQuery<T = Row>(cypher: string, params?: Params) {
      const reply = await (await connect()).selectGraph(name).roQuery<T>(cypher, { params });
      return reply.data ?? [];
    },
  };
}

export function accountsGraph(): AxonGraph {
  return openGraph(`${prefix()}_${ACCOUNTS}`);
}

export function workspaceGraph(slug: string): AxonGraph {
  // The slug becomes both a FalkorDB key and the /w/<slug>/mcp path, so only URL-safe slugs pass.
  if (!SLUG.test(slug) || slug === ACCOUNTS) {
    throw new Error(`Invalid workspace slug: ${slug}`);
  }
  return openGraph(`${prefix()}_${slug}`);
}

export async function listWorkspaceSlugs(): Promise<string[]> {
  const start = `${prefix()}_`;
  const graphs = await (await connect()).list();
  return graphs
    .filter((name) => name.startsWith(start))
    .map((name) => name.slice(start.length))
    .filter((slug) => slug !== ACCOUNTS && SLUG.test(slug));
}

export async function ping(): Promise<void> {
  await (await connect()).list();
}

export async function closeConnection(): Promise<void> {
  const db = cache.axonFalkor;
  cache.axonFalkor = undefined;
  if (db) await (await db).close();
}
