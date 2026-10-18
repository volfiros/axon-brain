import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeContext } from "@/tests/helpers/fake-context";

import { checkCitations, narrowest } from "./answers";
import type { CitationRow } from "./citations";
import type { Sensitivity } from "./write";

function cited(id: string, sensitivity: Sensitivity | null, extra: Partial<CitationRow> = {}): CitationRow {
  return { id, title: `Title ${id}`, status: "accepted", sensitivity, replacedBy: [], changedSources: 0, ...extra };
}

test("narrowest picks restricted over team over public", () => {
  assert.deepEqual(narrowest([cited("a", "public"), cited("b", "restricted"), cited("c", "team")]), { sensitivity: "restricted", from: "b" });
  assert.deepEqual(narrowest([cited("a", "public"), cited("b", "team")]), { sensitivity: "team", from: "b" });
  assert.deepEqual(narrowest([cited("a", "public")]), { sensitivity: "public", from: "a" });
});

test("narrowest treats a missing sensitivity as team", () => {
  assert.deepEqual(narrowest([cited("a", "public"), cited("b", null)]), { sensitivity: "team", from: "b" });
});

test("narrowest keeps the first of equally narrow decisions", () => {
  assert.deepEqual(narrowest([cited("a", "team"), cited("b", "team")]), { sensitivity: "team", from: "a" });
});

test("narrowest does not reorder the list it was given", () => {
  const list = [cited("a", "public"), cited("b", "restricted")];
  narrowest(list);
  assert.deepEqual(list.map((c) => c.id), ["a", "b"]);
});

test("checkCitations returns the cited decisions when all are current", async () => {
  const { ctx, calls } = fakeContext(() => [cited("dec_1", "team"), cited("dec_2", "public")]);
  const result = await checkCitations(ctx, [
    { text: "one", decision_ids: ["dec_1", "dec_2"] },
    { text: "two", decision_ids: ["dec_1"] },
  ]);
  assert.deepEqual([...result.keys()], ["dec_1", "dec_2"]);
  assert.deepEqual(calls[0].params.ids, ["dec_1", "dec_2"]);
  assert.equal(calls[0].readOnly, true);
});

test("checkCitations throws with a line for every cited decision that is not current", async () => {
  const { ctx } = fakeContext(() => [cited("dec_1", "team"), cited("dec_2", "team", { changedSources: 1 })]);
  await assert.rejects(checkCitations(ctx, [{ text: "x", decision_ids: ["dec_1", "dec_2", "dec_9"] }]), {
    message: [
      'dec_2 "Title dec_2": flagged, its source changed since it was recorded (see review_source_changes)',
      "dec_9: not_found_or_not_visible",
      "Cite only current decisions. Check a flagged one with review_source_changes first.",
    ].join("\n"),
  });
});
