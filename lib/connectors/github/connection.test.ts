import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { signState, verifyState } from "./connection";

const SECRET = "test-connector-state-secret";
process.env.CONNECTOR_STATE_SECRET = SECRET;

function stateWith(slug: string, expires: number, secret = SECRET): string {
  const payload = `${slug}.${expires}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

test("A freshly signed state verifies to its Workspace slug", () => {
  assert.equal(verifyState(signState("acme")), "acme");
});

test("A state for one slug cannot be edited to name another", () => {
  const [, expires, signature] = signState("acme").split(".");
  assert.equal(verifyState(`evil.${expires}.${signature}`), null);
});

test("A state with a pushed-out expiry fails", () => {
  const [slug, expires, signature] = signState("acme").split(".");
  assert.equal(verifyState(`${slug}.${Number(expires) + 3600}.${signature}`), null);
});

test("A state signed with another secret fails", () => {
  assert.equal(verifyState(stateWith("acme", inAnHour(), "other-secret")), null);
});

test("An expired state fails even with a valid signature", () => {
  assert.equal(verifyState(stateWith("acme", Math.floor(Date.now() / 1000) - 1)), null);
});

test("Malformed states fail", () => {
  assert.equal(verifyState(""), null);
  assert.equal(verifyState("acme"), null);
  assert.equal(verifyState(`acme.${inAnHour()}`), null);
  assert.equal(verifyState(`acme.${inAnHour()}.short`), null);
});

test("Signing throws when no state secret is configured", () => {
  delete process.env.CONNECTOR_STATE_SECRET;
  try {
    assert.throws(() => signState("acme"), /CONNECTOR_STATE_SECRET is not set/);
  } finally {
    process.env.CONNECTOR_STATE_SECRET = SECRET;
  }
});
