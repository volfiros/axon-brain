import assert from "node:assert/strict";
import { test } from "node:test";

import { ROLES } from "./roles";

test("There are exactly three roles, from most to least access", () => {
  assert.deepEqual([...ROLES], ["Admin", "Member", "Guest"]);
});
