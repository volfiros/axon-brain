import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeContext } from "@/tests/helpers/fake-context";

import { normalizeTitle, resolveDecisionMatch } from "./dedupe";

type Row = { id: string; title: string; status: string; sensitivity: string };

function decision(status: string, extra: Partial<Row> = {}): Row {
  return { id: "dec_1", title: "Manual refund approval", status, sensitivity: "team", ...extra };
}

function respondWith(byId: Row[], byTitle: Row[] = []) {
  return fakeContext((cypher) => (cypher.includes("fulltext") ? byTitle : byId));
}

test("normalizeTitle lowercases and collapses punctuation and spaces", () => {
  assert.equal(normalizeTitle("  Manual Refund-Approval (v2)! "), "manual refund approval v2");
  assert.equal(normalizeTitle("Use Postgres"), normalizeTitle("use   postgres."));
  assert.equal(normalizeTitle("???"), "");
});

test("A new decision with no same-title match is created", async () => {
  const { ctx } = respondWith([], [decision("accepted", { title: "Manual refund approvals for VIPs" })]);
  assert.deepEqual(await resolveDecisionMatch(ctx, "Manual refund approval", { kind: "new" }), { action: "create" });
});

test("A new decision whose normalized title matches a visible one links to it", async () => {
  const { ctx, calls } = respondWith([], [decision("proposed", { title: "manual refund-approval" })]);
  assert.deepEqual(await resolveDecisionMatch(ctx, "Manual Refund Approval", { kind: "new" }), {
    action: "link",
    decisionId: "dec_1",
    title: "manual refund-approval",
    status: "proposed",
    caughtByTitle: true,
  });
  assert.equal(calls[0].params.query, "manual refund approval");
  assert.equal(calls[0].params.personId, "p_caller");
  assert.ok(calls.every((c) => c.readOnly));
});

test("A new decision with a title of only one-letter words skips the title search", async () => {
  const { ctx, calls } = respondWith([]);
  assert.deepEqual(await resolveDecisionMatch(ctx, "A !", { kind: "new" }), { action: "create" });
  assert.equal(calls.length, 0);
});

test("A missing or hidden decision gives the same error", async () => {
  const { ctx } = respondWith([]);
  for (const kind of ["repeat", "change"] as const) {
    assert.deepEqual(await resolveDecisionMatch(ctx, "x", { kind, decision_id: "dec_9" }), {
      action: "error",
      reason: "No Decision dec_9 that you can see",
    });
  }
});

test("A dismissed decision cannot be repeated or changed", async () => {
  const { ctx } = respondWith([decision("dismissed")]);
  for (const kind of ["repeat", "change"] as const) {
    const result = await resolveDecisionMatch(ctx, "x", { kind, decision_id: "dec_1" });
    assert.deepEqual(result, { action: "error", reason: "Decision dec_1 was dismissed. Save this as new instead." });
  }
});

test("A repeat links to the decision, even a superseded one", async () => {
  for (const status of ["accepted", "proposed", "superseded"]) {
    const { ctx } = respondWith([decision(status)]);
    assert.deepEqual(await resolveDecisionMatch(ctx, "x", { kind: "repeat", decision_id: "dec_1" }), {
      action: "link",
      decisionId: "dec_1",
      title: "Manual refund approval",
      status,
      caughtByTitle: false,
    });
  }
});

test("A change supersedes the decision and keeps its sensitivity", async () => {
  const { ctx } = respondWith([decision("accepted", { sensitivity: "restricted" })]);
  assert.deepEqual(await resolveDecisionMatch(ctx, "x", { kind: "change", decision_id: "dec_1" }), {
    action: "supersede",
    decisionId: "dec_1",
    title: "Manual refund approval",
    sensitivity: "restricted",
  });
});

test("A change to an already superseded decision is an error", async () => {
  const { ctx } = respondWith([decision("superseded")]);
  assert.deepEqual(await resolveDecisionMatch(ctx, "x", { kind: "change", decision_id: "dec_1" }), {
    action: "error",
    reason: "Decision dec_1 is already superseded. Supersede the current one instead.",
  });
});
