import assert from "node:assert/strict";
import { test } from "node:test";

import { hops, label, rank, sourceChangeLine, type Detail } from "./recall";

function entry(id: string, status: string, coverage: number, score = 1, via = `(Topic: ${id})<-[:ABOUT]-`) {
  return { id, status, score, coverage, via };
}

test("rank merges entries for the same decision, adding scores and keeping each path once", () => {
  assert.deepEqual(rank([entry("dec_1", "accepted", 2, 1, "a"), entry("dec_1", "accepted", 2, 0.5, "b"), entry("dec_1", "accepted", 2, 1, "a")]), [
    { id: "dec_1", status: "accepted", score: 2.5, coverage: 2, paths: ["a", "b"] },
  ]);
});

test("rank puts superseded decisions last, whatever their coverage", () => {
  const ids = rank([entry("old", "superseded", 5, 9), entry("new", "accepted", 1)]).map((h) => h.id);
  assert.deepEqual(ids, ["new", "old"]);
});

test("rank orders by coverage, then accepted before proposed, then score", () => {
  const ids = rank([
    entry("low", "accepted", 1, 9),
    entry("proposed", "proposed", 3, 9),
    entry("accepted-weak", "accepted", 3, 1),
    entry("accepted-strong", "accepted", 3, 2),
  ]).map((h) => h.id);
  assert.deepEqual(ids, ["accepted-strong", "accepted-weak", "proposed", "low"]);
});

test("rank treats an unknown status like proposed", () => {
  const ids = rank([entry("odd", "draft", 1, 2), entry("proposed", "proposed", 1, 1), entry("accepted", "accepted", 1, 0)]).map((h) => h.id);
  assert.deepEqual(ids, ["accepted", "odd", "proposed"]);
});

function detail(status: string, confirmedBy: string | null): Detail {
  return {
    id: "dec_1",
    title: "Manual refunds",
    statement: "",
    status,
    confirmedBy,
    validFrom: null,
    validTo: null,
    maker: null,
    approver: null,
    because: [],
    hiddenReasons: 0,
    rejected: [],
    sources: [],
    hiddenSources: 0,
    sourceChanges: [],
    supersedes: [],
    supersededBy: [],
  };
}

test("label calls a decision accepted only when someone confirmed it", () => {
  assert.equal(label(detail("accepted", "p_ada")), "accepted");
  assert.equal(label(detail("accepted", null)), "proposed");
  assert.equal(label(detail("proposed", "p_ada")), "proposed");
  assert.equal(label(detail("superseded", null)), "superseded");
});

test("hops joins nodes with the relationship before each one", () => {
  assert.equal(hops(["(Decision: A)", "(Excerpt)", "(Doc: B)"], ["-[:DERIVED_FROM]->", "-[:IN]->"]), "(Decision: A)-[:DERIVED_FROM]->(Excerpt)-[:IN]->(Doc: B)");
  assert.equal(hops(["(Decision: A)"], []), "(Decision: A)");
});

test("hops is empty for no path and tolerates missing relationships", () => {
  assert.equal(hops(null, null), "");
  assert.equal(hops(["(A)", "(B)"], null), "(A)(B)");
});

test("sourceChangeLine says what changed, when, and how to resolve it", () => {
  assert.equal(
    sourceChangeLine({ title: "Refund policy", change: "edited", at: "2026-10-02T08:00:00" }),
    'The source "Refund policy" for this decision was edited on 2026-10-02; review it, then confirm it still holds with review_source_changes or replace it with supersede.',
  );
  assert.match(sourceChangeLine({ title: "Thread", change: "deleted", at: null }), /was deleted on unknown date;/);
});
