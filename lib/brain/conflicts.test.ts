import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeContext } from "@/tests/helpers/fake-context";

import { possibleConflicts } from "./conflicts";

const PAIR = {
  aId: "dec_a",
  aTitle: "Manual refunds",
  aStatement: "Refunds over $500 need approval.",
  bId: "dec_b",
  bTitle: "Automatic refunds",
  bStatement: "All refunds are automatic.",
  targets: ["src/billing/refunds.ts"],
};

type Backing = { id: string; at: string | null; labels: string[] | null; changed: boolean };

function conflictsFor(backing: Backing[], pairs = [PAIR]) {
  const { ctx, calls } = fakeContext((cypher) => (cypher.includes("ABOUT|AFFECTS") ? pairs : backing));
  return { result: possibleConflicts(ctx), calls };
}

test("No pairs means no conflicts and a single read", async () => {
  const { result, calls } = conflictsFor([], []);
  assert.deepEqual(await result, []);
  assert.equal(calls.length, 1);
});

test("The decision backed by the stronger kind of source is the likely one", async () => {
  const { result } = conflictsFor([
    { id: "dec_a", at: "2026-01-01", labels: ["Source", "Message"], changed: false },
    { id: "dec_b", at: "2025-01-01", labels: ["Source", "Doc"], changed: false },
  ]);
  assert.deepEqual(await result, [
    {
      decisions: [
        { id: "dec_a", title: "Manual refunds", statement: "Refunds over $500 need approval.", source: "a message or conversation" },
        { id: "dec_b", title: "Automatic refunds", statement: "All refunds are automatic.", source: "a doc" },
      ],
      targets: ["src/billing/refunds.ts"],
      likely: { id: "dec_b", reason: "source" },
    },
  ]);
});

test("Each decision is ranked by its strongest source", async () => {
  const { result } = conflictsFor([
    { id: "dec_a", at: "2026-01-01", labels: ["Source", "Message"], changed: false },
    { id: "dec_a", at: "2026-01-01", labels: ["Source", "PR"], changed: false },
    { id: "dec_b", at: "2026-01-01", labels: ["Source", "Thread"], changed: false },
  ]);
  const [conflict] = await result;
  assert.deepEqual(conflict.decisions.map((d) => d.source), ["a work item or PR", "a message or conversation"]);
  assert.deepEqual(conflict.likely, { id: "dec_a", reason: "source" });
});

test("With equal sources the newer decision is the likely one", async () => {
  const { result } = conflictsFor([
    { id: "dec_a", at: "2026-03-01", labels: ["Source", "Doc"], changed: false },
    { id: "dec_b", at: "2026-02-01", labels: ["Source", "Doc"], changed: false },
  ]);
  assert.deepEqual((await result)[0].likely, { id: "dec_a", reason: "newer" });
});

test("With equal sources and dates there is no likely one", async () => {
  const { result } = conflictsFor([
    { id: "dec_a", at: "2026-03-01", labels: ["Source", "Doc"], changed: false },
    { id: "dec_b", at: "2026-03-01", labels: ["Source", "Doc"], changed: false },
  ]);
  assert.equal((await result)[0].likely, null);
});

test("A decision with no visible source says so and loses to one with a source", async () => {
  const { result } = conflictsFor([
    { id: "dec_a", at: "2026-01-01", labels: null, changed: false },
    { id: "dec_b", at: "2026-01-01", labels: ["Source", "Meeting"], changed: false },
  ]);
  const [conflict] = await result;
  assert.equal(conflict.decisions[0].source, "no source you can see");
  assert.deepEqual(conflict.likely, { id: "dec_b", reason: "source" });
});

test("A source of an unranked kind counts the same as no source", async () => {
  const { result } = conflictsFor([
    { id: "dec_a", at: "2026-01-01", labels: ["Source", "Email"], changed: false },
    { id: "dec_b", at: "2026-02-01", labels: null, changed: false },
  ]);
  const [conflict] = await result;
  assert.equal(conflict.decisions[0].source, "no source you can see");
  assert.deepEqual(conflict.likely, { id: "dec_b", reason: "newer" });
});

test("A pair is left out while either decision has a changed source", async () => {
  const other = { ...PAIR, aId: "dec_c", bId: "dec_d" };
  const { result } = conflictsFor(
    [
      { id: "dec_a", at: "2026-01-01", labels: ["Source", "Doc"], changed: false },
      { id: "dec_b", at: "2026-01-01", labels: ["Source", "Doc"], changed: true },
      { id: "dec_c", at: "2026-01-01", labels: ["Source", "Doc"], changed: false },
      { id: "dec_d", at: "2026-01-01", labels: ["Source", "Doc"], changed: false },
    ],
    [PAIR, other],
  );
  assert.deepEqual((await result).map((c) => c.decisions.map((d) => d.id)), [["dec_c", "dec_d"]]);
});

test("Both reads go through the caller's read-only filter", async () => {
  const { result, calls } = conflictsFor([]);
  await result;
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.readOnly, true);
    assert.equal(call.params.personId, "p_caller");
  }
  assert.deepEqual(calls[1].params.ids, ["dec_a", "dec_b"]);
});
