import assert from "node:assert/strict";
import { test } from "node:test";

import { codeUnitId, projectId, sourceId } from "./write";

test("Source and Project ids are the connector and the external id", () => {
  assert.equal(sourceId("slack", "C1:1.0"), "slack:C1:1.0");
  assert.equal(projectId("plane", "proj-1"), "plane:proj-1");
});

test("A repository's CodeUnit id has no path and a file's id adds its path", () => {
  assert.equal(codeUnitId("acme/app", "/"), "cu:acme/app");
  assert.equal(codeUnitId("acme/app", "src/refunds.ts"), "cu:acme/app:src/refunds.ts");
});
