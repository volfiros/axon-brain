import { readFileSync } from "node:fs";

export type PlaneApi = {
  list<T>(path: string, query?: Record<string, string>): AsyncIterable<T>;
};

type Page<T> = { results: T[]; next_cursor?: string; next_page_results?: boolean };

const MIN_INTERVAL_MS = 1100;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function httpPlaneApi(opts: { apiUrl: string; apiKey: string; workspaceSlug: string }): PlaneApi {
  const base = `${opts.apiUrl.replace(/\/$/, "")}/api/v1/workspaces/${opts.workspaceSlug}`;
  let lastCall = 0;

  async function get<T>(path: string, query: Record<string, string>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      // Plane allows 60 requests a minute per key, so calls are spaced a little over a second apart.
      const wait = lastCall + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      const res = await fetch(`${base}${path}?${new URLSearchParams(query)}`, {
        headers: { "X-API-Key": opts.apiKey, Accept: "application/json" },
        // A redirect would carry the API key to another host, so a 3xx fails like any other error.
        redirect: "manual",
      });
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const reset = Number(res.headers.get("X-RateLimit-Reset")) * 1000;
        await sleep(reset > Date.now() ? reset - Date.now() : 60_000);
        continue;
      }
      if (!res.ok) throw new Error(`Plane GET ${path} failed: ${res.status}`);
      return (await res.json()) as T;
    }
  }

  return {
    async *list<T>(path: string, query: Record<string, string> = {}) {
      let cursor: string | undefined;
      do {
        const body = await get<T[] | Page<T>>(path, { ...query, per_page: "100", ...(cursor ? { cursor } : {}) });
        if (Array.isArray(body)) {
          yield* body;
          return;
        }
        yield* body.results;
        cursor = body.next_page_results ? body.next_cursor : undefined;
      } while (cursor);
    },
  };
}

/** Serves list calls from a JSON file of `{ "<path>": [items] }`, for loading fixtures without a Plane workspace. */
export function fixturePlaneApi(file: string): PlaneApi {
  const responses = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown[]>;
  return {
    async *list<T>(path: string) {
      yield* (responses[path] ?? []) as T[];
    },
  };
}
