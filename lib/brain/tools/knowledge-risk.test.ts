import assert from "node:assert/strict";
import { test } from "node:test";

import { busFactor } from "./knowledge-risk";

const person = (score: number, centrality = 0) => ({
  score: score + centrality,
  breakdown: { owns: 0, decisions: 0, authored: 0, workedOn: score, centrality },
});

test("The bus factor is the fewest people holding more than half, ignoring centrality", () => {
  assert.equal(busFactor([person(8), person(1), person(1)]), 1);
  assert.equal(busFactor([person(5), person(5)]), 2);
  assert.equal(busFactor([person(4), person(3), person(3, 10)]), 2);
  assert.equal(busFactor([]), 0);
});
