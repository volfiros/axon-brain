import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { searchSources } from "@/lib/brain/sources";
import type { BrainContext } from "@/lib/brain/tool";
import searchSourcesTool from "@/lib/brain/tools/search-sources";
import { writeBatch } from "@/lib/connectors/write";

import { callTool, seedCaller } from "../helpers/brain";
import { slackMessage } from "../helpers/connectors";
import { seedWorkspace } from "../helpers/fixtures";
import { useTestGraphs } from "../helpers/graph";

useTestGraphs();

let n = 0;
let admin: BrainContext;
let guest: BrainContext;

beforeEach(async () => {
  const slug = `src-${++n}`;
  await seedWorkspace(slug);
  admin = await seedCaller(slug, `${slug}-admin`, "Admin", "Ada Admin");
  guest = await seedCaller(slug, `${slug}-guest`, "Guest", "Gus Guest");
});

const at = (minutes: number) => new Date(Date.parse("2026-10-01T09:00:00Z") + minutes * 60_000).toISOString();
const say = (ts: string, text: string, minutes: number, extra = {}) =>
  writeBatch(admin.graph, slackMessage(ts, text, { created_at: at(minutes), channel: "slack:C100", ...extra }));

test("finds the message that covers the most query words, then the conversation around it", async () => {
  await say("1.1", "Customers keep asking about refunds", 0);
  await say("1.2", "Refund rounding should go down to the cent for EU invoices", 5);
  await say("1.3", "Agreed, I will update the invoice service", 10);
  await say("1.4", "Lunch is at noon", 60 * 24);

  const found = (await searchSources(admin, "refund rounding EU invoices", { limit: 3, direct: 1 }))!;
  assert.deepEqual(
    found.map((s) => [s.text, Boolean(s.near)]),
    [
      ["Refund rounding should go down to the cent for EU invoices", false],
      ["Customers keep asking about refunds", true],
      ["Agreed, I will update the invoice service", true],
    ],
  );
});

test("a Guest finds only Sources shared with Guests, and conversations stay within what they can see", async () => {
  await say("2.1", "Public roadmap: refunds ship in November", 0, { sensitivity: "public" });
  await say("2.2", "Internal: refunds margin is thin", 1);

  const reply = await callTool(searchSourcesTool, { query: "refunds" }, guest);
  assert.match(reply, /^1 Source for "refunds":/);
  assert.match(reply, /Public roadmap/);
  assert.doesNotMatch(reply, /margin/);
});
