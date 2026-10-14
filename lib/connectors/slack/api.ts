import { readFileSync } from "node:fs";

export type SlackApi = {
  call<T>(method: string, params?: Record<string, string>): Promise<T>;
};

type SlackReply = { ok: boolean; error?: string; response_metadata?: { next_cursor?: string } };

const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function httpSlackApi(token: string): SlackApi {
  return {
    async call<T>(method: string, params: Record<string, string> = {}) {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 429 && attempt < MAX_RETRIES) {
          await sleep((Number(res.headers.get("Retry-After")) || 30) * 1000);
          continue;
        }
        const body = (await res.json()) as SlackReply;
        if (!body.ok) throw new Error(`Slack ${method} failed: ${body.error ?? res.status}`);
        return body as T;
      }
    },
  };
}

export async function* paginate<T>(
  api: SlackApi,
  method: string,
  key: string,
  params: Record<string, string> = {},
): AsyncIterable<T> {
  let cursor = "";
  do {
    const body = await api.call<SlackReply & Record<string, unknown>>(method, {
      ...params,
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });
    yield* (body[key] as T[] | undefined) ?? [];
    cursor = body.response_metadata?.next_cursor ?? "";
  } while (cursor);
}

/** Serves calls from a JSON file keyed by `method`, `method:channel` or `method:channel:ts`, for loading fixtures. */
export function fixtureSlackApi(file: string): SlackApi {
  const responses = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  return {
    async call<T>(method: string, params: Record<string, string> = {}) {
      const key = [method, params.channel, params.ts].filter(Boolean).join(":");
      const body = responses[key];
      if (!body) throw new Error(`No Slack fixture for ${key}`);
      return { ok: true, ...(body as object) } as T;
    },
  };
}
