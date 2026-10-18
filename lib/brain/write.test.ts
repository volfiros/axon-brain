import assert from "node:assert/strict";
import { test } from "node:test";

import { renderPlan, type ItemInput, type ItemPlan } from "./write";

function input(extra: Partial<ItemInput> = {}): ItemInput {
  return {
    kind: "decision",
    title: "Manual refund approval",
    statement: "Refunds over $500 wait for manual approval.",
    because_ids: [],
    new_constraints: [],
    new_assumptions: [],
    rejected: [],
    affects: [],
    about: [],
    excerpt: "anything over 500 needs a human",
    source_title: "Billing sync",
    ...extra,
  } as ItemInput;
}

function plan(extra: Partial<ItemPlan> = {}, inputExtra: Partial<ItemInput> = {}): ItemPlan {
  return { input: input(inputExtra), sensitivity: "team", reasons: [], targets: [], unmatched: [], topics: [], similar: [], ...extra };
}

test("A bare decision says what is missing", () => {
  assert.equal(
    renderPlan(plan()),
    [
      "Kind: decision",
      "Title: Manual refund approval",
      "Statement: Refunds over $500 wait for manual approval.",
      "Because: none given",
      "Rejected: none given",
      "Affects: nothing linked",
      'Source: "anything over 500 needs a human" (Billing sync)',
      "Visible to: team",
    ].join("\n"),
  );
});

test("A full decision lists reasons, alternatives, targets, topics and similar decisions", () => {
  const text = renderPlan(
    plan(
      {
        sensitivity: "restricted",
        reasons: [{ id: "con_1", statement: "The processor freezes payouts" }],
        targets: [{ id: "cu_1", label: "CodeUnit", name: "src/billing/refunds.ts" }],
        unmatched: ["Refund desk"],
        topics: ["refunds", "billing"],
        similar: [{ id: "dec_2", title: "Refund limits", status: "accepted" }],
      },
      {
        new_constraints: ["Payouts freeze above $500"],
        new_assumptions: ["Most refunds are small"],
        rejected: [{ title: "Auto approve", reason: "too risky" }],
        source_url: "https://example.com/thread/1",
      },
    ),
  );
  assert.equal(
    text,
    [
      "Kind: decision",
      "Title: Manual refund approval",
      "Statement: Refunds over $500 wait for manual approval.",
      "Because: The processor freezes payouts (con_1); Payouts freeze above $500 (new constraint); Most refunds are small (new assumption)",
      "Rejected: Auto approve: too risky",
      "Affects: CodeUnit src/billing/refunds.ts",
      "Not found in the graph, will be skipped: Refund desk",
      "About: refunds, billing",
      'Source: "anything over 500 needs a human" (Billing sync, https://example.com/thread/1)',
      "Visible to: restricted",
      "Similar decisions already saved (use supersede if this replaces one): Refund limits (dec_2, accepted)",
    ].join("\n"),
  );
});

test("Items other than decisions have no because or rejected lines", () => {
  const text = renderPlan(plan({}, { kind: "constraint", title: undefined, statement: "Payouts freeze above $500." }));
  assert.equal(
    text,
    [
      "Kind: constraint",
      "Statement: Payouts freeze above $500.",
      "Affects: nothing linked",
      'Source: "anything over 500 needs a human" (Billing sync)',
      "Visible to: team",
    ].join("\n"),
  );
});
