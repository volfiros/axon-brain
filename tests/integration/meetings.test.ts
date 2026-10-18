import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { FROM_CALLER, readAsCaller, visible } from "@/lib/brain/access";
import type { BrainContext } from "@/lib/brain/tool";
import { linkIdentity } from "@/lib/connectors/identity";
import type { Batch, NodeRef } from "@/lib/connectors/types";
import { writeBatch } from "@/lib/connectors/write";

import { seedCaller } from "../helpers/brain";
import { seedWorkspace } from "../helpers/fixtures";
import { useTestGraphs } from "../helpers/graph";

useTestGraphs();

let n = 0;
let admin: BrainContext;
let attendee: BrainContext;
let outsider: BrainContext;

beforeEach(async () => {
  const slug = `meet-${++n}`;
  await seedWorkspace(slug);
  admin = await seedCaller(slug, `${slug}-admin`, "Admin", "Ada Admin");
  attendee = await seedCaller(slug, `${slug}-mel`, "Member", "Mel Member");
  outsider = await seedCaller(slug, `${slug}-nia`, "Member", "Nia Member");
});

const person = (id: string): NodeRef => ({ kind: "person", connector: "meet", external_id: id });
const source = (id: string): NodeRef => ({ kind: "source", connector: "meet", external_id: id });
const attendees = ["u1", "u2"].map((id) => ({ connector: "meet", external_id: id }));

const meeting: Batch = {
  people: [
    { connector: "meet", external_id: "u1", name: "Mel" },
    { connector: "meet", external_id: "u2", name: "Org" },
  ],
  sources: [
    {
      connector: "meet",
      external_id: "m1",
      labels: ["Meeting"],
      title: "Refunds sync",
      text: "Mel: Refunds stay manual for v1.",
      url: "https://meet.example.test/m1",
      created_at: "2026-10-10T09:00:00Z",
      sensitivity: "restricted",
      visible_to: attendees,
    },
    {
      connector: "meet",
      external_id: "m1:1",
      labels: ["Message"],
      title: "Chat in Refunds sync",
      text: "Spec: https://docs.example.test/refunds",
      url: "https://meet.example.test/m1",
      created_at: "2026-10-10T09:05:00Z",
      sensitivity: "restricted",
      visible_to: attendees,
    },
  ],
  links: [
    { from: person("u1"), rel: "ATTENDED", to: source("m1") },
    { from: person("u2"), rel: "ATTENDED", to: source("m1") },
    { from: person("u2"), rel: "AUTHORED", to: source("m1") },
    { from: source("m1:1"), rel: "PART_OF", to: source("m1") },
  ],
};

async function meetingsSeenBy(ctx: BrainContext): Promise<string[]> {
  const rows = await readAsCaller<{ title: string }>(
    ctx,
    `${FROM_CALLER} MATCH (s:Source) WHERE (s:Meeting OR (s)-[:PART_OF]->(:Meeting)) AND ${visible("s")} RETURN s.title AS title ORDER BY title`,
  );
  return rows.map((r) => r.title);
}

test("a meeting and its chat are visible to Admins and attendees only, and attendance follows a linked member", async () => {
  await writeBatch(admin.graph, meeting);
  await linkIdentity(admin.graph, attendee.caller.personId, "meet:u1");

  assert.deepEqual(await meetingsSeenBy(admin), ["Chat in Refunds sync", "Refunds sync"]);
  assert.deepEqual(await meetingsSeenBy(attendee), ["Chat in Refunds sync", "Refunds sync"]);
  assert.deepEqual(await meetingsSeenBy(outsider), []);

  const rows = await admin.graph.query<{ name: string }>(
    "MATCH (p:Person)-[:ATTENDED]->(:Meeting {id: 'meet:m1'}) RETURN p.name AS name ORDER BY name",
  );
  assert.deepEqual(rows.map((r) => r.name), ["Mel Member", "Org"]);
});
