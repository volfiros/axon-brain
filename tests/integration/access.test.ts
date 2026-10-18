import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { rankPeople } from "@/lib/brain/people";
import type { BrainContext } from "@/lib/brain/tool";
import changesSince from "@/lib/brain/tools/changes-since";
import checkAnswer from "@/lib/brain/tools/check-answer";
import impact from "@/lib/brain/tools/impact";
import recall from "@/lib/brain/tools/recall";
import whoKnows from "@/lib/brain/tools/who-knows";

import { callTool, saveItem, seedCaller, seedTeam, seedTeamSource } from "../helpers/brain";
import { seedWorkspace } from "../helpers/fixtures";
import { useTestGraphs } from "../helpers/graph";

useTestGraphs();

const slug = "access";
let admin: BrainContext;
let member: BrainContext;
let teammate: BrainContext;
let guest: BrainContext;
const ids: Record<"ledger" | "retry" | "freeze" | "rotate" | "secret" | "vendor", string> = {
  ledger: "",
  retry: "",
  freeze: "",
  rotate: "",
  secret: "",
  vendor: "",
};

const ASK_ADMIN = /restricted decisions? on this, ask Ada Admin\./;

before(async () => {
  await seedWorkspace(slug);
  admin = await seedCaller(slug, "acc-ada", "Admin", "Ada Admin");
  member = await seedCaller(slug, "acc-mel", "Member", "Mel Member");
  teammate = await seedCaller(slug, "acc-tia", "Member", "Tia Teammate");
  guest = await seedCaller(slug, "acc-gus", "Guest", "Gus Guest");
  await seedTeam(slug, "Payments", [teammate.caller.personId]);
  await seedTeamSource(slug, "src_payments_private", "Payments");

  ids.ledger = (await saveItem(admin, {
    title: "Store ledger entries in Postgres",
    statement: "Ledger entries live in Postgres.",
    about: ["ledger"],
    sensitivity: "public",
  })).itemId;
  ids.retry = (await saveItem(member, {
    title: "Retry refund webhooks with backoff",
    statement: "Refund webhooks retry with exponential backoff.",
    about: ["refunds"],
  })).itemId;
  ids.freeze = (await saveItem(
    teammate,
    {
      title: "Freeze refund pricing for enterprise",
      statement: "Enterprise refund pricing is frozen until renewal.",
      about: ["refunds"],
      sensitivity: "restricted",
    },
    { id: "src_payments_private" },
  )).itemId;
  ids.rotate = (await saveItem(member, {
    title: "Rotate refund signing keys quarterly",
    statement: "Refund signing keys rotate every quarter.",
    about: ["refunds"],
    sensitivity: "restricted",
  })).itemId;
  ids.secret = (await saveItem(admin, {
    kind: "constraint",
    statement: "The payout vendor caps calls at forty per second.",
    sensitivity: "restricted",
  })).itemId;
  ids.vendor = (await saveItem(admin, {
    title: "Batch payout vendor calls",
    statement: "Payout vendor calls are batched.",
    about: ["payouts"],
    because_ids: [ids.secret],
  })).itemId;
});

function recallAs(ctx: BrainContext, question: string) {
  return callTool(recall, { question, limit: 5 }, ctx);
}

describe("recall visibility", () => {
  test("an Admin sees every refund decision and no restricted note", async () => {
    const out = await recallAs(admin, "refund");
    for (const id of [ids.retry, ids.freeze, ids.rotate]) assert.match(out, new RegExp(id));
    assert.doesNotMatch(out, ASK_ADMIN);
  });

  test("a Member outside the Team sees team decisions and their own restricted one, and only a note for the Team one", async () => {
    const out = await recallAs(member, "refund");
    assert.match(out, new RegExp(ids.retry));
    assert.match(out, new RegExp(ids.rotate));
    assert.doesNotMatch(out, new RegExp(ids.freeze));
    assert.doesNotMatch(out, /Freeze refund pricing|frozen until renewal/);
    assert.match(out, /There is also a restricted decision on this, ask Ada Admin\./);
  });

  test("a Team member sees the Team-restricted decision but not another person's restricted one", async () => {
    const out = await recallAs(teammate, "refund");
    assert.match(out, new RegExp(ids.retry));
    assert.match(out, new RegExp(ids.freeze));
    assert.doesNotMatch(out, new RegExp(ids.rotate));
    assert.doesNotMatch(out, /Rotate refund signing keys|every quarter/);
    assert.match(out, /There is also a restricted decision on this, ask Ada Admin\./);
  });

  test("a Guest gets only the ask-the-Admin line for team and restricted decisions", async () => {
    const out = await recallAs(guest, "refund");
    assert.equal(out, "There are 3 restricted decisions on this, ask Ada Admin.");
  });

  test("a Guest sees a public decision", async () => {
    const out = await recallAs(guest, "ledger");
    assert.match(out, new RegExp(ids.ledger));
    assert.match(out, /Answer: Ledger entries live in Postgres\./);
  });

  test("a hidden reason is counted but its statement is never shown", async () => {
    const out = await recallAs(member, "payout vendor");
    assert.match(out, new RegExp(ids.vendor));
    assert.match(out, /Because: no reason you can see\. There is a restricted reason on this, ask Ada Admin\./);
    assert.doesNotMatch(out, /forty per second/);
  });

  test("an Admin sees the restricted reason", async () => {
    const out = await recallAs(admin, "payout vendor");
    assert.match(out, /Because: The payout vendor caps calls at forty per second\./);
  });
});

describe("other read tools", () => {
  test("impact on a constraint the caller cannot see gives only the restricted note", async () => {
    const out = await callTool(impact, { constraint: ids.secret }, member);
    assert.equal(out, "There is a restricted constraint on this, ask Ada Admin.");
  });

  test("impact on a visible constraint lists the decisions that rely on it", async () => {
    const out = await callTool(impact, { constraint: ids.secret }, admin);
    assert.match(out, /1 decision relied on it:/);
    assert.match(out, new RegExp(`Batch payout vendor calls \\(accepted, ${ids.vendor}\\)`));
  });

  test("check_answer treats a hidden decision like a missing one", async () => {
    const out = await callTool(checkAnswer, { statements: [{ text: "Pricing is frozen.", decision_ids: [ids.freeze] }] }, member);
    assert.match(out, new RegExp(`${ids.freeze}: not_found_or_not_visible`));
    assert.doesNotMatch(out, /Freeze refund pricing/);
  });

  test("who_knows ranks people only from decisions the caller can see", async () => {
    const forMember = await rankPeople(member, "refunds");
    assert.deepEqual(forMember?.map((p) => p.name), ["Mel Member"]);
    const forTeammate = await rankPeople(teammate, "refunds");
    assert.deepEqual(forTeammate?.map((p) => p.name).sort(), ["Mel Member", "Tia Teammate"]);
    const forAdmin = await rankPeople(admin, "refunds");
    assert.equal(forAdmin?.find((p) => p.name === "Mel Member")?.breakdown.decisions, 6);
  });

  test("who_knows tells a Guest no one is linked when every decision is hidden", async () => {
    assert.deepEqual(await rankPeople(guest, "refunds"), []);
    assert.equal(await callTool(whoKnows, { topic: "refunds" }, guest), 'No one in this workspace is linked to "refunds" yet.');
  });

  test("changes_since lists only the decisions each caller can see", async () => {
    const since = "2000-01-01";
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const forGuest = await callTool(changesSince, { since, until }, guest);
    assert.match(forGuest, /1 of 1 changes/);
    assert.match(forGuest, new RegExp(`decision created: Store ledger entries in Postgres \\(${ids.ledger}\\)`));

    const forMember = await callTool(changesSince, { since, until, limit: 50 }, member);
    assert.match(forMember, new RegExp(ids.rotate));
    assert.doesNotMatch(forMember, new RegExp(ids.freeze));

    const forTeammate = await callTool(changesSince, { since, until, limit: 50 }, teammate);
    assert.match(forTeammate, new RegExp(ids.freeze));
    assert.doesNotMatch(forTeammate, new RegExp(ids.rotate));
  });
});
