import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { BrainContext } from "@/lib/brain/tool";
import impact from "@/lib/brain/tools/impact";
import proposeFromSource from "@/lib/brain/tools/propose-from-source";
import recall from "@/lib/brain/tools/recall";
import reviewProposals from "@/lib/brain/tools/review-proposals";
import save from "@/lib/brain/tools/save";
import supersede from "@/lib/brain/tools/supersede";
import { writeBatch } from "@/lib/connectors/write";

import { callTool, saveItem, seedCaller } from "../helpers/brain";
import { contentHash, slackMessage } from "../helpers/connectors";
import { seedWorkspace } from "../helpers/fixtures";
import { useTestGraphs } from "../helpers/graph";

useTestGraphs();

let n = 0;
let slug: string;
let admin: BrainContext;
let member: BrainContext;
let guest: BrainContext;

beforeEach(async () => {
  slug = `dec-${++n}`;
  await seedWorkspace(slug);
  admin = await seedCaller(slug, `${slug}-admin`, "Admin", "Ada Admin");
  member = await seedCaller(slug, `${slug}-member`, "Member", "Mel Member");
  guest = await seedCaller(slug, `${slug}-guest`, "Guest", "Gus Guest");
});

const decision = {
  kind: "decision" as const,
  title: "Skip duplicate webhook events",
  statement: "Webhook handlers skip events whose id was already processed.",
  excerpt: "let's just drop duplicates by event id",
  source_title: "Webhook planning chat",
  about: ["webhooks"],
};

async function decisionRow(ctx: BrainContext, id: string) {
  const [row] = await ctx.graph.query<{ status: string; confirmedBy: string | null; validTo: unknown; sensitivity: string; confirmedAt: unknown }>(
    `MATCH (d:Decision {id: $id})
     RETURN d.status AS status, d.confirmed_by AS confirmedBy, d.valid_to AS validTo, d.sensitivity AS sensitivity, d.confirmed_at AS confirmedAt`,
    { id },
  );
  return row;
}

async function decisionCount(ctx: BrainContext): Promise<number> {
  const [row] = await ctx.graph.query<{ n: number }>("MATCH (d:Decision) RETURN count(d) AS n");
  return row.n;
}

function savedId(reply: string): string {
  const id = /Saved (?:decision )?(dec_[0-9a-f]{8})/.exec(reply)?.[1];
  assert.ok(id, reply);
  return id;
}

describe("save", () => {
  test("a preview writes nothing", async () => {
    const out = await callTool(save, decision, member);
    assert.match(out, /Nothing is saved yet\./);
    assert.match(out, /Title: Skip duplicate webhook events/);
    assert.equal(await decisionCount(member), 0);
  });

  test("confirming saves an accepted decision confirmed by the caller", async () => {
    const id = savedId(await callTool(save, { ...decision, confirm: true }, member));
    const row = await decisionRow(member, id);
    assert.equal(row.status, "accepted");
    assert.equal(row.confirmedBy, member.caller.personId);
    assert.equal(row.sensitivity, "team");
  });

  test("a Guest cannot save", async () => {
    await assert.rejects(callTool(save, { ...decision, confirm: true }, guest), /Guests can read the brain but not save to it/);
    assert.equal(await decisionCount(guest), 0);
  });
});

describe("proposals from a connector Source", () => {
  const ts = "1760000000.000100";
  const sourceId = `slack:C100:${ts}`;
  const text = "Agreed: we will pin the payments SDK to v4 until the refund bug is fixed.";
  const proposal = {
    title: "Pin the payments SDK to v4",
    statement: "The payments SDK stays on v4 until the refund bug is fixed.",
    excerpt: "we will pin the payments SDK to v4",
  };

  test("propose_from_source writes a proposed decision made by the Source's author", async () => {
    await writeBatch(member.graph, slackMessage(ts, text));
    const out = await callTool(
      proposeFromSource,
      { source_id: sourceId, content_hash: await contentHash(member.graph, sourceId), items: [proposal] },
      member,
    );
    assert.match(out, /Proposed 1 decision from "Message in #payments"\./);
    const [row] = await member.graph.query<{ status: string; maker: string; extraction: string }>(
      `MATCH (d:Decision)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source {id: $sourceId}), (d)-[:MADE_BY]->(p:Person)
       RETURN d.status AS status, p.name AS maker, s.extraction AS extraction`,
      { sourceId },
    );
    assert.deepEqual(row, { status: "proposed", maker: "Sam Slack", extraction: "done" });
  });

  test("an excerpt that is not in the Source text writes nothing", async () => {
    await writeBatch(member.graph, slackMessage(ts, text));
    await assert.rejects(
      callTool(
        proposeFromSource,
        { source_id: sourceId, content_hash: await contentHash(member.graph, sourceId), items: [{ ...proposal, excerpt: "we will pin it forever" }] },
        member,
      ),
      /not word for word/,
    );
    assert.equal(await decisionCount(member), 0);
  });

  test("accepting a proposal sets accepted, confirmed_by and confirmed_at", async () => {
    await writeBatch(member.graph, slackMessage(ts, text));
    await callTool(
      proposeFromSource,
      { source_id: sourceId, content_hash: await contentHash(member.graph, sourceId), items: [proposal] },
      member,
    );
    const [{ id }] = await member.graph.query<{ id: string }>("MATCH (d:Decision {status: 'proposed'}) RETURN d.id AS id");
    const out = await callTool(reviewProposals, { action: "accept", ids: [id] }, admin);
    assert.equal(out, `Accepted by Ada Admin: Pin the payments SDK to v4 (${id})`);
    const row = await decisionRow(admin, id);
    assert.equal(row.status, "accepted");
    assert.equal(row.confirmedBy, admin.caller.personId);
    assert.ok(row.confirmedAt);
  });
});

describe("supersede", () => {
  const replacement = {
    title: "Skip duplicate webhook events by delivery id",
    statement: "Webhook handlers skip deliveries whose delivery id was already processed.",
    excerpt: "use the delivery id instead",
    source_title: "Webhook follow-up",
  };

  test("a preview names the decision it replaces and writes nothing", async () => {
    const { itemId: oldId } = await saveItem(member, decision);
    const out = await callTool(supersede, { ...replacement, old_id: oldId }, member);
    assert.match(out, new RegExp(`Replaces: Skip duplicate webhook events \\(${oldId}, accepted\\)`));
    assert.equal(await decisionCount(member), 1);
    assert.equal((await decisionRow(member, oldId)).status, "accepted");
  });

  test("confirming keeps the old decision as history with status, valid_to and SUPERSEDES", async () => {
    const { itemId: oldId } = await saveItem(member, { ...decision, sensitivity: "public" });
    const newId = savedId(await callTool(supersede, { ...replacement, old_id: oldId, confirm: true }, member));

    const old = await decisionRow(member, oldId);
    assert.equal(old.status, "superseded");
    assert.ok(old.validTo);
    const [edge] = await member.graph.query<{ n: number }>(
      "MATCH (:Decision {id: $newId})-[r:SUPERSEDES]->(:Decision {id: $oldId}) RETURN count(r) AS n",
      { newId, oldId },
    );
    assert.equal(edge.n, 1);
    const fresh = await decisionRow(member, newId);
    assert.equal(fresh.status, "accepted");
    assert.equal(fresh.sensitivity, "public");

    const out = await callTool(recall, { question: "duplicate webhook events", limit: 5 }, member);
    assert.match(out, new RegExp(`Decision: Skip duplicate webhook events by delivery id \\(accepted, ${newId}\\)`));
    assert.match(out, /Supersedes: Skip duplicate webhook events\n/);
    assert.match(out, new RegExp(`Decision: Skip duplicate webhook events \\(superseded, ${oldId}\\)`));
    assert.match(out, /Superseded by: Skip duplicate webhook events by delivery id/);
  });

  test("a superseded decision cannot be superseded again", async () => {
    const { itemId: oldId } = await saveItem(member, decision);
    await callTool(supersede, { ...replacement, old_id: oldId, confirm: true }, member);
    await assert.rejects(
      callTool(supersede, { ...replacement, old_id: oldId, confirm: true }, member),
      /is already superseded/,
    );
  });

  test("a decision the caller cannot see cannot be superseded", async () => {
    const { itemId: oldId } = await saveItem(admin, { ...decision, sensitivity: "restricted" });
    await assert.rejects(callTool(supersede, { ...replacement, old_id: oldId, confirm: true }, member), /No decision you can see/);
  });
});

describe("impact", () => {
  test("lists the current decisions that rely on a constraint and leaves out superseded ones", async () => {
    const { itemId: constraintId } = await saveItem(member, {
      kind: "constraint",
      statement: "The card processor allows two retries per charge.",
    });
    const { itemId: retries } = await saveItem(member, {
      title: "Cap charge retries at two",
      statement: "Charges retry at most twice.",
      because_ids: [constraintId],
      affects: [],
    });
    const { itemId: oldAlerts } = await saveItem(member, {
      title: "Alert after two failed retries",
      statement: "On-call is paged after two failed retries.",
      because_ids: [constraintId],
    });
    await callTool(
      supersede,
      {
        title: "Alert after any failed retry",
        statement: "On-call is paged after any failed retry.",
        excerpt: "page on any failure",
        source_title: "Incident review",
        old_id: oldAlerts,
        confirm: true,
      },
      member,
    );

    const out = await callTool(impact, { constraint: constraintId }, member);
    assert.match(out, /If this constraint stops being true: "The card processor allows two retries per charge\."/);
    assert.match(out, /1 decision relied on it:/);
    assert.match(out, new RegExp(`- Cap charge retries at two \\(accepted, ${retries}\\), decided by Mel Member\\.`));
    assert.doesNotMatch(out, /Alert after two failed retries/);
  });

  test("finds a constraint by words from its statement", async () => {
    const { itemId: constraintId } = await saveItem(member, {
      kind: "constraint",
      statement: "The card processor allows two retries per charge.",
    });
    await saveItem(member, { title: "Cap charge retries at two", statement: "Charges retry at most twice.", because_ids: [constraintId] });
    const out = await callTool(impact, { constraint: "card processor retries" }, member);
    assert.match(out, new RegExp(`\\(${constraintId}\\)`));
    assert.match(out, /Cap charge retries at two/);
  });
});
