import assert from "node:assert/strict";
import { test } from "node:test";

import { signState } from "./github/connection";
import { githubIdentity, signLinkState, verifyLinkState } from "./link";

process.env.CONNECTOR_STATE_SECRET = "test-state-secret";

test("A link state names the workspace, the account that started linking and the page to return to", () => {
  assert.deepEqual(verifyLinkState(signLinkState("acme", "acct1")), { slug: "acme", accountId: "acct1", page: "members" });
  assert.deepEqual(verifyLinkState(signLinkState("acme", "acct1", "setup")), { slug: "acme", accountId: "acct1", page: "setup" });
});

test("A tampered link state, or a connector install state, is not a link state", () => {
  const state = signLinkState("acme", "acct1");
  assert.equal(verifyLinkState(state.replace("acct1", "acct2")), null);
  assert.equal(verifyLinkState(signState("acme")), null);
  assert.equal(verifyLinkState(""), null);
});

test("A GitHub sign-in becomes the github:<user id> identity", async () => {
  const replies = [{ access_token: "t" }, { id: 42, login: "gil" }];
  const fakeFetch = (async () => new Response(JSON.stringify(replies.shift()))) as typeof fetch;
  assert.equal(await githubIdentity("code", fakeFetch), "github:42");
});

test("A failed GitHub sign-in throws", async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({ error: "bad_verification_code" }))) as typeof fetch;
  await assert.rejects(githubIdentity("code", fakeFetch), /bad_verification_code/);
});
