import assert from "node:assert/strict";
import { test } from "node:test";

import { memberContext } from "./overview";

test("memberContext reads the member's workspace graph as that member, with no teams", () => {
  const ctx = memberContext("acme", { personId: "p_ada", name: "Ada", handle: "ada", role: "Guest" });
  assert.match(ctx.graph.name, /_acme$/);
  assert.deepEqual(ctx.caller, { personId: "p_ada", name: "Ada", role: "Guest", teams: [], workspace: "acme" });
});

test("memberContext refuses an invalid workspace slug", () => {
  assert.throws(() => memberContext("../accounts", { personId: "p_ada", name: "Ada", handle: null, role: "Admin" }), /Invalid workspace slug/);
});
