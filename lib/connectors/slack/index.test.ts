import assert from "node:assert/strict";
import { test } from "node:test";

import { hmacHex, slackMessage } from "@/tests/helpers/connector-payloads";

import type { Batch, ConnectorContext } from "../types";
import type { SlackApi } from "./api";
import { backfillWith, slackConnector, slackEventBatches, verifySlackSignature, type SlackEnvelope } from "./index";

const SECRET = "test-slack-signing-secret";
process.env.SLACK_SIGNING_SECRET = SECRET;

const body = "token=x&type=event_callback";
const now = 1_760_000_000_000;
const ts = String(now / 1000);

function sign(timestamp: string, rawBody = body, secret = SECRET): string {
  return `v0=${hmacHex(secret, `v0:${timestamp}:${rawBody}`)}`;
}

async function collect(items: AsyncIterable<Batch>): Promise<Batch[]> {
  const all: Batch[] = [];
  for await (const item of items) all.push(item);
  return all;
}

test("A request signed with the signing secret within five minutes passes", () => {
  assert.equal(verifySlackSignature(body, ts, sign(ts), SECRET, now), true);
  assert.equal(verifySlackSignature(body, ts, sign(ts), SECRET, now + 299_000), true);
});

test("A request signed with another secret fails", () => {
  assert.equal(verifySlackSignature(body, ts, sign(ts, body, "other-secret"), SECRET, now), false);
});

test("A request whose body changed after signing fails", () => {
  assert.equal(verifySlackSignature(`${body}&extra=1`, ts, sign(ts), SECRET, now), false);
});

test("A request whose timestamp was changed after signing fails", () => {
  const later = String(Number(ts) + 10);
  assert.equal(verifySlackSignature(body, later, sign(ts), SECRET, now), false);
});

test("A request signed more than five minutes ago, or in the future, fails", () => {
  const old = String(Number(ts) - 301);
  assert.equal(verifySlackSignature(body, old, sign(old), SECRET, now), false);
  const future = String(Number(ts) + 301);
  assert.equal(verifySlackSignature(body, future, sign(future), SECRET, now), false);
});

test("A request with a missing header or no secret fails", () => {
  assert.equal(verifySlackSignature(body, null, sign(ts), SECRET, now), false);
  assert.equal(verifySlackSignature(body, ts, null, SECRET, now), false);
  assert.equal(verifySlackSignature(body, ts, sign(ts, body, ""), "", now), false);
});

test("A request with a non-numeric timestamp fails even when its signature matches", () => {
  for (const bad of ["soon", "", "NaN", "Infinity"]) {
    assert.equal(verifySlackSignature(body, bad, sign(bad), SECRET, now), false, bad);
  }
});

test("The connector reads the signature and timestamp headers and the configured secret", () => {
  const stamp = String(Math.floor(Date.now() / 1000));
  const request = (signature: string) =>
    new Request("https://axon.test/api/slack/events", {
      method: "POST",
      headers: { "X-Slack-Request-Timestamp": stamp, "X-Slack-Signature": signature },
      body,
    });
  assert.equal(slackConnector.verifyWebhook(request(sign(stamp)), body), true);
  assert.equal(slackConnector.verifyWebhook(request(sign(stamp, body, "other-secret")), body), false);
});

function fakeApi(responses: Record<string, Record<string, unknown>>): SlackApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call<T>(method: string, params: Record<string, string> = {}) {
      const key = [method, params.channel, params.ts].filter(Boolean).join(":");
      calls.push(key);
      const reply = responses[key];
      if (!reply) throw new Error(`No fake reply for ${key}`);
      return { ok: true, ...reply } as T;
    },
  };
}

test("Backfill yields people and named bots, then messages and replies from channels the bot is in", async () => {
  const api = fakeApi({
    "auth.test": { url: "https://acme.slack.test/" },
    "users.list": {
      members: [
        { id: "U1", name: "ada" },
        { id: "U2", name: "grace" },
        { id: "B1", name: "bot", real_name: "Deploy Bot", is_bot: true },
        { id: "B2", name: "oldbot", is_bot: true, deleted: true },
      ],
    },
    "conversations.list": {
      channels: [
        { id: "C1", name: "general", is_member: true },
        { id: "C2", name: "random", is_member: false },
        { id: "G1", name: "secret", is_private: true, is_member: true },
      ],
    },
    "conversations.history:C1": {
      messages: [
        slackMessage({ ts: "1.0", reply_count: 1, thread_ts: "1.0" }),
        slackMessage({ ts: "2.0", subtype: "channel_join", text: "joined" }),
      ],
    },
    "conversations.replies:C1:1.0": {
      messages: [slackMessage({ ts: "1.0", thread_ts: "1.0" }), slackMessage({ ts: "1.5", thread_ts: "1.0", text: "Agreed" })],
    },
    "conversations.members:G1": { members: ["U1", "B1"] },
    "conversations.history:G1": { messages: [slackMessage({ ts: "3.0", text: "Private plan" })] },
  });

  const batches = await collect(backfillWith(api, { workspace: "acme" } as ConnectorContext));

  assert.deepEqual(
    batches[0].people?.map((p) => [p.external_id, p.name]),
    [
      ["U1", "ada"],
      ["U2", "grace"],
      ["B1", "Deploy Bot"],
    ],
  );
  const sources = batches.slice(1).flatMap((b) => b.sources ?? []);
  assert.deepEqual(
    sources.map((s) => s.external_id),
    ["C1:1.0", "C1:1.5", "G1:3.0"],
  );
  assert.deepEqual(
    sources[2].visible_to?.map((p) => p.external_id),
    ["U1"],
  );
  assert.equal(api.calls.includes("conversations.history:C2"), false);
});

test("An incremental backfill asks Slack only for messages after the resume point", async () => {
  const seen: Record<string, string>[] = [];
  const api: SlackApi = {
    async call<T>(method: string, params: Record<string, string> = {}) {
      if (method === "conversations.history") seen.push(params);
      const replies: Record<string, unknown> = {
        "auth.test": { url: "https://acme.slack.test" },
        "users.list": { members: [] },
        "conversations.list": { channels: [{ id: "C1", name: "general", is_member: true }] },
        "conversations.history": { messages: [] },
      };
      return { ok: true, ...(replies[method] as object) } as T;
    },
  };
  await collect(backfillWith(api, { workspace: "acme", since: "2026-10-01T00:00:00Z" } as ConnectorContext));
  assert.equal(seen[0].oldest, String(Date.parse("2026-10-01T00:00:00Z") / 1000));
});

test("Envelopes that are not message callbacks, and direct messages, yield nothing", async () => {
  const ctx = { workspace: "acme" } as ConnectorContext;
  const envelopes: SlackEnvelope[] = [
    { type: "url_verification" },
    { type: "event_callback" },
    { type: "event_callback", event: { type: "message", channel: "D1", channel_type: "im", user: "U1", ts: "1.0", text: "hi" } },
    { type: "event_callback", event: { type: "message", channel: "C1", channel_type: "mpim", user: "U1", ts: "1.0", text: "hi" } },
    { type: "event_callback", event: { type: "reaction_added", channel: "C1" } },
    { type: "event_callback", event: { type: "message", subtype: "channel_join", channel: "C1", user: "U1", ts: "1.0", text: "joined" } },
  ];
  for (const envelope of envelopes) {
    assert.deepEqual(await collect(slackEventBatches(envelope, ctx)), [], JSON.stringify(envelope));
  }
});
