import assert from "node:assert/strict";
import { test } from "node:test";

import { ghComment, ghPull, ghRepo, ghReview, hmacHex } from "@/tests/helpers/connector-payloads";

import type { Batch, ConnectorContext } from "../types";
import { eventNeedsToken, github, type GhEvent } from "./index";

const SECRET = "test-github-webhook-secret";
process.env.GITHUB_WEBHOOK_SECRET = SECRET;

const body = JSON.stringify({ action: "opened", number: 7 });

function signed(rawBody: string, signature: string | null): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== null) headers.set("x-hub-signature-256", signature);
  return new Request("https://axon.test/api/github/webhook", { method: "POST", headers, body: rawBody });
}

const ctx = { workspace: "acme" } as ConnectorContext;

async function batchesFor(name: string, event: GhEvent): Promise<Batch[]> {
  const all: Batch[] = [];
  for await (const batch of github.eventToBatches(new Headers({ "x-github-event": name }), event, ctx)) all.push(batch);
  return all;
}

test("A webhook signed with the shared secret passes", () => {
  assert.equal(github.verifyWebhook(signed(body, `sha256=${hmacHex(SECRET, body)}`), body), true);
});

test("A webhook signed with another secret fails", () => {
  assert.equal(github.verifyWebhook(signed(body, `sha256=${hmacHex("other-secret", body)}`), body), false);
});

test("A webhook whose body changed after signing fails", () => {
  const tampered = body.replace("opened", "closed");
  assert.equal(github.verifyWebhook(signed(tampered, `sha256=${hmacHex(SECRET, body)}`), tampered), false);
});

test("A webhook without a signature header, or with a malformed one, fails", () => {
  assert.equal(github.verifyWebhook(signed(body, null), body), false);
  assert.equal(github.verifyWebhook(signed(body, hmacHex(SECRET, body)), body), false);
  assert.equal(github.verifyWebhook(signed(body, "sha256=short"), body), false);
});

test("A webhook fails when no secret is configured", () => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
  try {
    assert.equal(github.verifyWebhook(signed(body, `sha256=${hmacHex("", body)}`), body), false);
  } finally {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  }
});

test("Only pushes and pull requests with new commits need an installation token", () => {
  assert.equal(eventNeedsToken("push", {}), true);
  assert.equal(eventNeedsToken("pull_request", { action: "opened" }), true);
  assert.equal(eventNeedsToken("pull_request", { action: "synchronize" }), true);
  assert.equal(eventNeedsToken("pull_request", { action: "edited" }), false);
  assert.equal(eventNeedsToken("pull_request_review", { action: "submitted" }), false);
  assert.equal(eventNeedsToken(null, {}), false);
});

test("An edited pull request becomes its PR Source without reading files", async () => {
  const batches = await batchesFor("pull_request", { action: "edited", repository: ghRepo(), pull_request: ghPull() });
  assert.equal(batches.length, 1);
  assert.deepEqual(
    batches[0].sources?.map((s) => s.external_id),
    ["acme/app/pull/7"],
  );
});

test("A submitted review carries its pull request along", async () => {
  const [batch] = await batchesFor("pull_request_review", {
    action: "submitted",
    repository: ghRepo(),
    pull_request: ghPull(),
    review: ghReview(),
  });
  assert.deepEqual(
    batch.sources?.map((s) => s.external_id),
    ["acme/app/pull/7", "acme/app/review/501"],
  );
});

test("A dismissed review yields nothing", async () => {
  const batches = await batchesFor("pull_request_review", {
    action: "dismissed",
    repository: ghRepo(),
    pull_request: ghPull(),
    review: ghReview(),
  });
  assert.deepEqual(batches, []);
});

test("A deleted review comment is marked deleted", async () => {
  const [batch] = await batchesFor("pull_request_review_comment", {
    action: "deleted",
    repository: ghRepo(),
    pull_request: ghPull(),
    comment: ghComment({ path: "src/refunds.ts" }),
  });
  const comment = batch.sources?.find((s) => s.external_id === "acme/app/review-comment/901");
  assert.ok(comment?.deleted_at);
});

test("A comment on a pull request is kept and a comment on a plain issue is ignored", async () => {
  const { head: _head, ...issue } = ghPull();
  const onPull = await batchesFor("issue_comment", {
    action: "created",
    repository: ghRepo(),
    issue: { ...issue, pull_request: { html_url: "https://github.com/acme/app/pull/7" } },
    comment: ghComment(),
  });
  assert.deepEqual(
    onPull[0].sources?.map((s) => s.external_id),
    ["acme/app/pull/7", "acme/app/comment/901"],
  );
  const onIssue = await batchesFor("issue_comment", { action: "created", repository: ghRepo(), issue, comment: ghComment() });
  assert.deepEqual(onIssue, []);
});

test("Events without a repository, and unknown event names, yield nothing", async () => {
  assert.deepEqual(await batchesFor("pull_request", { action: "edited", pull_request: ghPull() }), []);
  assert.deepEqual(await batchesFor("star", { action: "created", repository: ghRepo() }), []);
});

test("A push to a branch other than the default yields nothing", async () => {
  const batches = await batchesFor("push", { repository: ghRepo(), ref: "refs/heads/feature", after: "abc", commits: [] });
  assert.deepEqual(batches, []);
});
