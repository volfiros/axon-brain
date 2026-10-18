import assert from "node:assert/strict";
import { test } from "node:test";

import { findNode } from "./graph-algorithm";

const nodes = new Map(
  [
    { key: "source:github:acme/pay/pull/7", kind: "PR", name: "Refund rounding" },
    { key: "source:github:acme/pay/pull/8", kind: "PR", name: "Refund rounding v2" },
    { key: "person:p_1", kind: "Person", name: "Ada" },
  ].map((n) => [n.key, n]),
);

test("An exact id or name wins over partial name matches", () => {
  assert.equal(findNode(nodes, "github:acme/pay/pull/8"), nodes.get("source:github:acme/pay/pull/8"));
  assert.equal(findNode(nodes, "refund rounding"), nodes.get("source:github:acme/pay/pull/7"));
  assert.equal(findNode(nodes, "ada"), nodes.get("person:p_1"));
});

test("Several partial matches ask for an id, and no match says so", () => {
  assert.match(findNode(nodes, "refund") as string, /matches several/);
  assert.equal(findNode(nodes, "billing"), 'Nothing you can see matches "billing".');
});
