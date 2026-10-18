import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { BrainContext } from "@/lib/brain/tool";
import answerStatus from "@/lib/brain/tools/answer-status";
import proposeFromSource from "@/lib/brain/tools/propose-from-source";
import reviewProposals from "@/lib/brain/tools/review-proposals";
import saveAnswer from "@/lib/brain/tools/save-answer";
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
  slug = `ans-${++n}`;
  await seedWorkspace(slug);
  admin = await seedCaller(slug, `${slug}-admin`, "Admin", "Ada Admin");
  member = await seedCaller(slug, `${slug}-member`, "Member", "Mel Member");
  guest = await seedCaller(slug, `${slug}-guest`, "Guest", "Gus Guest");
});

function answerFor(decisionId: string, question = "How do we handle duplicate webhooks?") {
  return { question, statements: [{ text: "Duplicates are skipped by event id.", decision_ids: [decisionId] }] };
}

async function answerCount(ctx: BrainContext): Promise<number> {
  const [row] = await ctx.graph.query<{ n: number }>("MATCH (a:Answer) RETURN count(a) AS n");
  return row.n;
}

function savedAnswerId(reply: string): string {
  const id = /(?:Saved answer|Already saved as) (ans_[0-9a-f]{8})/.exec(reply)?.[1];
  assert.ok(id, reply);
  return id;
}

async function webhookDecision(ctx: BrainContext, sensitivity: "public" | "team" = "team") {
  const { itemId } = await saveItem(ctx, {
    title: "Skip duplicate webhook events",
    statement: "Webhook handlers skip events whose id was already processed.",
    sensitivity,
  });
  return itemId;
}

const ts = "1760000000.000200";
const sourceId = `slack:C100:${ts}`;
const text = "Decision: refunds over 500 EUR need a second approver.";

async function decisionFromSlack(): Promise<string> {
  await writeBatch(member.graph, slackMessage(ts, text));
  await callTool(
    proposeFromSource,
    {
      source_id: sourceId,
      content_hash: await contentHash(member.graph, sourceId),
      items: [{ title: "Second approver for large refunds", statement: "Refunds over 500 EUR need two approvers.", excerpt: "refunds over 500 EUR need a second approver" }],
    },
    member,
  );
  const [{ id }] = await member.graph.query<{ id: string }>("MATCH (d:Decision {status: 'proposed'}) RETURN d.id AS id");
  await callTool(reviewProposals, { action: "accept", ids: [id] }, member);
  return id;
}

describe("save_answer", () => {
  test("a preview writes nothing", async () => {
    const decisionId = await webhookDecision(member);
    const out = await callTool(saveAnswer, answerFor(decisionId), member);
    assert.match(out, /Nothing is saved yet\./);
    assert.match(out, new RegExp(`Cites: Skip duplicate webhook events \\(${decisionId}\\)`));
    assert.match(out, /Visible to: team, the narrowest of the cited decisions/);
    assert.equal(await answerCount(member), 0);
  });

  test("confirming saves the answer once and a second save returns the existing one", async () => {
    const decisionId = await webhookDecision(member);
    const first = await callTool(saveAnswer, { ...answerFor(decisionId), confirm: true }, member);
    assert.match(first, /^Saved answer ans_/);
    const second = await callTool(saveAnswer, { ...answerFor(decisionId), confirm: true }, member);
    assert.match(second, /^Already saved as ans_[0-9a-f]{8}, nothing new written\./);
    assert.equal(savedAnswerId(second), savedAnswerId(first));
    assert.equal(await answerCount(member), 1);
  });

  test("an answer citing a decision that is not current is refused", async () => {
    const decisionId = await webhookDecision(member);
    await callTool(
      supersede,
      { title: "Skip duplicates by delivery id", statement: "Skip by delivery id.", excerpt: "delivery id", source_title: "Chat", old_id: decisionId, confirm: true },
      member,
    );
    await assert.rejects(callTool(saveAnswer, { ...answerFor(decisionId), confirm: true }, member), /superseded, replaced_by/);
    assert.equal(await answerCount(member), 0);
  });

  test("a Guest cannot save an answer", async () => {
    const decisionId = await webhookDecision(member, "public");
    await assert.rejects(callTool(saveAnswer, { ...answerFor(decisionId), confirm: true }, guest), /Guests can read the brain/);
  });
});

describe("stale answers", () => {
  test("an answer goes stale when a cited decision is superseded and names the replacement", async () => {
    const decisionId = await webhookDecision(member);
    await callTool(saveAnswer, { ...answerFor(decisionId), confirm: true }, member);
    const reply = await callTool(
      supersede,
      { title: "Skip duplicates by delivery id", statement: "Skip by delivery id.", excerpt: "delivery id", source_title: "Chat", old_id: decisionId, confirm: true },
      member,
    );
    const newId = /Saved (dec_[0-9a-f]{8})/.exec(reply)![1];

    const out = await callTool(answerStatus, { stale_only: true }, member);
    assert.match(out, /, stale\), saved by Mel Member/);
    assert.match(out, /: "Skip duplicate webhook events" was superseded\./);
    assert.match(out, new RegExp(`Replaced by: Skip duplicates by delivery id \\(${newId}\\)`));
  });

  test("an answer goes stale when the Source behind a cited decision is edited", async () => {
    const decisionId = await decisionFromSlack();
    await callTool(saveAnswer, { ...answerFor(decisionId, "Who approves large refunds?"), confirm: true }, member);
    assert.equal(await callTool(answerStatus, { stale_only: true }, member), "No saved answer you can see is stale.");

    await writeBatch(member.graph, slackMessage(ts, "Decision: refunds over 1000 EUR need a second approver.", { updated_at: "2026-10-02T09:00:00Z" }));
    const out = await callTool(answerStatus, { stale_only: true }, member);
    assert.match(out, /Who approves large refunds\? \(ans_[0-9a-f]{8}, stale\)/);
    assert.match(out, /A source of "Second approver for large refunds" was edited\./);
  });

  test("an answer goes stale when the Source behind a cited decision is deleted", async () => {
    const decisionId = await decisionFromSlack();
    await callTool(saveAnswer, { ...answerFor(decisionId, "Who approves large refunds?"), confirm: true }, member);
    await writeBatch(member.graph, slackMessage(ts, text, { deleted_at: "2026-10-03T09:00:00Z" }));
    const out = await callTool(answerStatus, {}, member);
    assert.match(out, /A source of "Second approver for large refunds" was deleted\./);
  });

  test("replaying the same Source batch leaves the answer current", async () => {
    const decisionId = await decisionFromSlack();
    await callTool(saveAnswer, { ...answerFor(decisionId, "Who approves large refunds?"), confirm: true }, member);
    await writeBatch(member.graph, slackMessage(ts, text));
    assert.equal(await callTool(answerStatus, { stale_only: true }, member), "No saved answer you can see is stale.");
  });
});

describe("answer_status visibility", () => {
  test("a Guest cannot see an answer that cites a team decision", async () => {
    const decisionId = await webhookDecision(member);
    await callTool(saveAnswer, { ...answerFor(decisionId), confirm: true }, member);
    assert.equal(await callTool(answerStatus, {}, guest), "No saved answers you can see.");
    assert.match(await callTool(answerStatus, {}, admin), /How do we handle duplicate webhooks\?/);
  });

  test("a Guest sees an answer that cites only public decisions", async () => {
    const decisionId = await webhookDecision(member, "public");
    await callTool(saveAnswer, { ...answerFor(decisionId), confirm: true }, member);
    assert.match(await callTool(answerStatus, {}, guest), /How do we handle duplicate webhooks\? \(ans_[0-9a-f]{8}, current\)/);
  });

  test("an answer citing a public and a team decision takes the team audience", async () => {
    const publicId = await webhookDecision(member, "public");
    const { itemId: teamId } = await saveItem(member, { title: "Log webhook payloads", statement: "Webhook payloads are logged for a week." });
    await callTool(
      saveAnswer,
      {
        question: "What happens to webhooks?",
        statements: [
          { text: "Duplicates are skipped.", decision_ids: [publicId] },
          { text: "Payloads are logged.", decision_ids: [teamId] },
        ],
        confirm: true,
      },
      member,
    );
    assert.equal(await callTool(answerStatus, {}, guest), "No saved answers you can see.");
    assert.match(await callTool(answerStatus, {}, member), /What happens to webhooks\?/);
  });

  test("a Member cannot see an answer that cites someone else's restricted decision", async () => {
    const { itemId } = await saveItem(admin, { title: "Hold payouts for new sellers", statement: "Payouts wait 14 days for new sellers.", sensitivity: "restricted" });
    await callTool(saveAnswer, { ...answerFor(itemId, "When are new sellers paid?"), confirm: true }, admin);
    assert.equal(await callTool(answerStatus, {}, member), "No saved answers you can see.");
    assert.match(await callTool(answerStatus, {}, admin), /When are new sellers paid\?/);
  });
});
