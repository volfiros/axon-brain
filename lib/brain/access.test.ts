import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeContext } from "@/tests/helpers/fake-context";

import { adminName, FROM_CALLER, readAsCaller, restrictedNote, shown, visible } from "./access";

test("FROM_CALLER starts every read from the calling Person and their Role", () => {
  assert.equal(FROM_CALLER, "MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)");
});

test("visible allows the caller, their Role or one of their Teams", () => {
  assert.equal(
    visible("d"),
    "((d)-[:VISIBLE_TO]->(u) OR (d)-[:VISIBLE_TO]->(role) OR (d)-[:VISIBLE_TO]->(:Team)<-[:MEMBER_OF]-(u))",
  );
});

test("shown also lets through nodes that carry no VISIBLE_TO at all", () => {
  assert.equal(shown("x"), `(NOT (x)-[:VISIBLE_TO]->() OR ${visible("x")})`);
});

test("readAsCaller runs read-only and always binds the caller's personId", async () => {
  const { ctx, calls } = fakeContext(() => [{ id: "dec_1" }], { personId: "p_me" });
  const rows = await readAsCaller(ctx, "MATCH (n) RETURN n.id AS id", { q: "refunds", personId: "p_someone_else" });
  assert.deepEqual(rows, [{ id: "dec_1" }]);
  assert.deepEqual(calls, [{ cypher: "MATCH (n) RETURN n.id AS id", params: { q: "refunds", personId: "p_me" }, readOnly: true }]);
});

test("adminName falls back when the workspace has no Admin", async () => {
  assert.equal(await adminName(fakeContext(() => [{ name: "Ada" }]).ctx), "Ada");
  assert.equal(await adminName(fakeContext(() => []).ctx), "a workspace Admin");
});

test("restrictedNote is empty for zero and names the Admin otherwise", async () => {
  const { ctx, calls } = fakeContext(() => [{ name: "Ada" }]);
  assert.equal(await restrictedNote(ctx, 0, "decision"), "");
  assert.equal(calls.length, 0);
  assert.equal(await restrictedNote(ctx, 1, "decision"), "There is a restricted decision on this, ask Ada.");
  assert.equal(await restrictedNote(ctx, 3, "source"), "There are 3 restricted sources on this, ask Ada.");
});
