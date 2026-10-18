import assert from "node:assert/strict";
import { test } from "node:test";

import { isStale } from "./sync";

function utcMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19);
}

test("A connector that never started a sync is stale", () => {
  assert.equal(isStale(null), true);
});

test("A sync started a minute ago is still running", () => {
  assert.equal(isStale(utcMinutesAgo(1)), false);
});

test("A sync started more than six minutes ago is treated as stopped", () => {
  assert.equal(isStale(utcMinutesAgo(7)), true);
});
