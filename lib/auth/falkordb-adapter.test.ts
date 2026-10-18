import assert from "node:assert/strict";
import { test } from "node:test";

import type { CleanedWhere } from "better-auth/adapters";

import type { Params } from "@/lib/graph/client";

import { label, safe, whereClause } from "./falkordb-adapter";

function where(field: string, value: unknown, operator: CleanedWhere["operator"] = "eq", extra: Partial<CleanedWhere> = {}): CleanedWhere {
  return { field, value, operator, connector: "AND", mode: "sensitive", ...extra } as CleanedWhere;
}

function build(clauses: CleanedWhere[] | undefined): { cypher: string; params: Params } {
  const params: Params = {};
  return { cypher: whereClause(clauses, params), params };
}

test("Better Auth's user and account models map to the glossary's Account and Credential", () => {
  assert.equal(label("user"), "`Account`");
  assert.equal(label("account"), "`Credential`");
});

test("Other models become a capitalized, quoted label", () => {
  assert.equal(label("session"), "`Session`");
  assert.equal(label("oauthClient"), "`OauthClient`");
});

test("Identifiers that could break out of a label or property are refused", () => {
  for (const name of ["x`) DETACH DELETE n //", "a b", "1abc", "_id", "a-b", "", "a.b", "a$"]) {
    assert.throws(() => safe(name), /Unsafe graph identifier/, name);
  }
  assert.throws(() => label("session` OR 1=1"), /Unsafe graph identifier/);
});

test("Plain identifiers pass through", () => {
  assert.equal(safe("emailVerified"), "emailVerified");
  assert.equal(safe("user_id2"), "user_id2");
});

test("No clauses means no WHERE", () => {
  assert.deepEqual(build(undefined), { cypher: "", params: {} });
  assert.deepEqual(build([]), { cypher: "", params: {} });
});

test("Values are always passed as parameters, never inlined", () => {
  const { cypher, params } = build([where("email", "a@example.com' OR 1=1 //")]);
  assert.equal(cypher, "WHERE n.`email` = $w0");
  assert.deepEqual(params, { w0: "a@example.com' OR 1=1 //" });
});

test("A field name that is not a plain identifier is refused", () => {
  assert.throws(() => build([where("email` = '' OR true //", "x")]), /Unsafe graph identifier/);
});

test("Each operator renders its Cypher comparison", () => {
  const cases: [CleanedWhere["operator"], unknown, string][] = [
    ["eq", "x", "n.`f` = $w0"],
    ["eq", null, "n.`f` IS NULL"],
    ["ne", "x", "n.`f` <> $w0"],
    ["ne", null, "n.`f` IS NOT NULL"],
    ["lt", 1, "n.`f` < $w0"],
    ["lte", 1, "n.`f` <= $w0"],
    ["gt", 1, "n.`f` > $w0"],
    ["gte", 1, "n.`f` >= $w0"],
    ["in", ["a"], "n.`f` IN $w0"],
    ["not_in", ["a"], "NOT n.`f` IN $w0"],
    ["contains", "a", "n.`f` CONTAINS $w0"],
    ["starts_with", "a", "n.`f` STARTS WITH $w0"],
    ["ends_with", "a", "n.`f` ENDS WITH $w0"],
  ];
  for (const [operator, value, expected] of cases) {
    assert.equal(build([where("f", value, operator)]).cypher, `WHERE ${expected}`, operator);
  }
});

test("Case-insensitive clauses lowercase both sides", () => {
  const insensitive = { mode: "insensitive" } as const;
  assert.equal(build([where("email", "A@x.com", "eq", insensitive)]).cypher, "WHERE toLower(n.`email`) = toLower($w0)");
  assert.equal(build([where("email", ["A"], "in", insensitive)]).cypher, "WHERE toLower(n.`email`) IN [v IN $w0 | toLower(v)]");
  assert.equal(build([where("email", ["A"], "not_in", insensitive)]).cypher, "WHERE NOT toLower(n.`email`) IN [v IN $w0 | toLower(v)]");
  assert.equal(build([where("name", "A", "contains", insensitive)]).cypher, "WHERE toLower(n.`name`) CONTAINS toLower($w0)");
});

test("Clauses fold left to right with each clause's own connector", () => {
  const { cypher, params } = build([
    where("email", "a@example.com"),
    where("username", "ada", "eq", { connector: "OR" }),
    where("banned", true, "ne"),
  ]);
  assert.equal(cypher, "WHERE ((n.`email` = $w0) OR n.`username` = $w1) AND n.`banned` <> $w2");
  assert.deepEqual(params, { w0: "a@example.com", w1: "ada", w2: true });
});
