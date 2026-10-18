import assert from "node:assert/strict";
import { test } from "node:test";

import { accountsGraph, workspaceGraph } from "./client";

const PREFIX = process.env.FALKORDB_GRAPH_PREFIX || "axon";

test("Each workspace gets its own graph under the prefix, apart from accounts", () => {
  assert.equal(workspaceGraph("acme").name, `${PREFIX}_acme`);
  assert.equal(workspaceGraph("acme-2").name, `${PREFIX}_acme-2`);
  assert.equal(accountsGraph().name, `${PREFIX}_accounts`);
});

test("Slugs that are not lowercase kebab-case are refused", () => {
  for (const slug of ["", "Acme", "acme_co", "acme--co", "-acme", "acme-", "acme/co", "../acme", "acme co", "acme:co"]) {
    assert.throws(() => workspaceGraph(slug), /Invalid workspace slug/, slug);
  }
});

test("A workspace cannot be named after the accounts graph", () => {
  assert.throws(() => workspaceGraph("accounts"), { message: "Invalid workspace slug: accounts" });
});
