import assert from "node:assert/strict";
import { test } from "node:test";

import { day, searchTerms } from "./search";

test("searchTerms drops stopwords and short words and joins the rest with OR", () => {
  assert.deepEqual(searchTerms("How do we handle refunds that were approved?"), {
    fulltext: "handle|refunds|approved",
    stems: ["handle", "refund", "approv"],
  });
});

test("searchTerms lowercases, splits on punctuation and removes duplicates", () => {
  assert.deepEqual(searchTerms("Refunds, REFUNDS and refunds!").fulltext, "refunds");
  assert.deepEqual(searchTerms("api-v2 Postgres_DB").fulltext, "api|postgres");
});

test("searchTerms returns nothing searchable for only stopwords", () => {
  assert.deepEqual(searchTerms("The the THE a an to"), { fulltext: "", stems: [] });
  assert.deepEqual(searchTerms(""), { fulltext: "", stems: [] });
});

test("Stems strip one common suffix and keep at least four letters", () => {
  assert.deepEqual(searchTerms("processing tested approval refunds boxes bus").stems, ["process", "test", "approv", "refund", "boxe", "bus"]);
  assert.deepEqual(searchTerms("rated uses").stems, ["rated", "uses"]);
});

test("day keeps the date part of an ISO date-time", () => {
  assert.equal(day("2026-10-18T10:00:00"), "2026-10-18");
  assert.equal(day("2026-10-18"), "2026-10-18");
});

test("day says unknown date for null or undefined", () => {
  assert.equal(day(null), "unknown date");
  assert.equal(day(undefined), "unknown date");
});
