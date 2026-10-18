import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { FROM_CALLER, readAsCaller, visible } from "@/lib/brain/access";
import type { BrainContext } from "@/lib/brain/tool";
import { linkIdentity } from "@/lib/connectors/identity";
import { writeBatch } from "@/lib/connectors/write";

import { seedCaller } from "../helpers/brain";
import { slackMessage, slackUser } from "../helpers/connectors";
import { seedWorkspace } from "../helpers/fixtures";
import { useTestGraphs } from "../helpers/graph";

useTestGraphs();

let n = 0;
let admin: BrainContext;
let member: BrainContext;

beforeEach(async () => {
  const slug = `idn-${++n}`;
  await seedWorkspace(slug);
  admin = await seedCaller(slug, `${slug}-admin`, "Admin", "Ada Admin");
  member = await seedCaller(slug, `${slug}-member`, "Member", "Mel Member");
});

const ts = "1760000000.000500";

async function visibleMessages(ctx: BrainContext): Promise<number> {
  const [row] = await readAsCaller<{ n: number }>(ctx, `${FROM_CALLER} MATCH (s:Source:Message) WHERE ${visible("s")} RETURN count(DISTINCT s) AS n`);
  return row.n;
}

async function authorOf(sourceId: string): Promise<string | null> {
  const [row] = await admin.graph.query<{ id: string }>("MATCH (p:Person)-[:AUTHORED]->(:Source {id: $id}) RETURN p.id AS id", { id: sourceId });
  return row?.id ?? null;
}

describe("linkIdentity", () => {
  test("linking a Slack identity moves its private-channel access and authorship onto the member", async () => {
    await writeBatch(admin.graph, slackMessage(ts, "Private plan", { sensitivity: "restricted", visible_to: [slackUser] }));
    assert.equal(await visibleMessages(member), 0);

    assert.equal(await linkIdentity(member.graph, member.caller.personId, "slack:U100"), "linked");

    assert.equal(await visibleMessages(member), 1);
    assert.equal(await authorOf(`slack:C100:${ts}`), member.caller.personId);
    const people = await admin.graph.query<{ id: string }>("MATCH (p:Person) WHERE 'slack:U100' IN p.external_ids RETURN p.id AS id");
    assert.deepEqual(people, [{ id: member.caller.personId }]);
  });

  test("a later sync of a linked identity writes to the member", async () => {
    assert.equal(await linkIdentity(member.graph, member.caller.personId, "slack:U100"), "linked");
    await writeBatch(admin.graph, slackMessage(ts, "Shipping today"));
    assert.equal(await authorOf(`slack:C100:${ts}`), member.caller.personId);
    assert.equal(await linkIdentity(member.graph, member.caller.personId, "slack:U100"), "already linked");
  });

  test("an identity another member linked cannot be taken", async () => {
    await writeBatch(admin.graph, slackMessage(ts, "Hello"));
    assert.equal(await linkIdentity(member.graph, member.caller.personId, "slack:U100"), "linked");
    assert.equal(await linkIdentity(admin.graph, admin.caller.personId, "slack:U100"), "taken");
    assert.equal(await authorOf(`slack:C100:${ts}`), member.caller.personId);
  });

  test("linking Slack also absorbs a separate Plane person with the same email", async () => {
    await writeBatch(admin.graph, { people: [{ connector: "plane", external_id: "u-1", name: "Mel P", email: "mel@acme.test" }] });
    await writeBatch(admin.graph, { people: [{ connector: "slack", external_id: "U100", name: "Mel S" }] });
    await admin.graph.query("MATCH (p:Person) WHERE 'slack:U100' IN p.external_ids SET p.email = 'mel@acme.test'");

    assert.equal(await linkIdentity(member.graph, member.caller.personId, "slack:U100"), "linked");

    const people = await admin.graph.query<{ id: string; ids: string[] }>(
      "MATCH (p:Person) WHERE p.email = 'mel@acme.test' RETURN p.id AS id, p.external_ids AS ids",
    );
    assert.deepEqual(people, [{ id: member.caller.personId, ids: ["slack:U100", "plane:u-1"] }]);
  });

  test("a member with the same email is never absorbed", async () => {
    await admin.graph.query("MATCH (p:Person {id: $id}) SET p.email = 'mel@acme.test'", { id: admin.caller.personId });
    await writeBatch(admin.graph, { people: [{ connector: "slack", external_id: "U100", name: "Mel S", email: "mel@acme.test" }] });
    await linkIdentity(member.graph, member.caller.personId, "slack:U100");
    const [row] = await admin.graph.query<{ n: number }>("MATCH (p:Person {id: $id}) RETURN count(p) AS n", { id: admin.caller.personId });
    assert.equal(row.n, 1);
  });
});

