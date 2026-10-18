import assert from "node:assert/strict";
import { test } from "node:test";

import { ghComment, ghPull, ghRepo, ghReview, ghUser } from "@/tests/helpers/connector-payloads";

import {
  commentBatch,
  commitBatch,
  docBatch,
  isDocPath,
  mergeBatches,
  ownershipBatch,
  personOf,
  pullBatch,
  reviewBatch,
  type GhCommit,
} from "./normalize";

const repo = ghRepo();
const pr7 = { kind: "source", connector: "github", external_id: "acme/app/pull/7" };

test("Docs are README.md, Markdown under docs/ and ADR folders, never docs/archive", () => {
  assert.equal(isDocPath("README.md"), true);
  assert.equal(isDocPath("docs/product.md"), true);
  assert.equal(isDocPath("services/api/adr/0001-queues.md"), true);
  assert.equal(isDocPath("ADRs/0002.md"), true);
  assert.equal(isDocPath("docs/archive/old.md"), false);
  assert.equal(isDocPath("docs/diagram.png"), false);
  assert.equal(isDocPath("src/README.md"), false);
});

test("A human user becomes a Person and a bot does not", () => {
  assert.deepEqual(personOf(ghUser()), { connector: "github", external_id: "101", handle: "ada", name: "ada" });
  assert.equal(personOf(ghUser({ type: "Bot", login: "ci" })), null);
  assert.equal(personOf(ghUser({ login: "dependabot[bot]" })), null);
  assert.equal(personOf(null), null);
});

test("A pull request becomes a PR Source with its author, branch and touched files", () => {
  const batch = pullBatch(repo, ghPull(), ["src/refunds.ts"]);
  assert.deepEqual(batch.sources, [
    {
      connector: "github",
      external_id: "acme/app/pull/7",
      labels: ["PR"],
      title: "PR #7: Fix refunds",
      text: "Refunds now round down.",
      url: "https://github.com/acme/app/pull/7",
      created_at: "2026-10-01T10:00:00Z",
      updated_at: "2026-10-02T10:00:00Z",
      sensitivity: "public",
      branch: "feat/bil-12-refunds",
    },
  ]);
  assert.deepEqual(batch.people, [{ connector: "github", external_id: "101", handle: "ada", name: "ada" }]);
  assert.deepEqual(batch.links, [
    { from: { kind: "person", connector: "github", external_id: "101", handle: "ada", name: "ada" }, rel: "AUTHORED", to: pr7 },
    { from: pr7, rel: "TOUCHES", to: { kind: "codeunit", repo: "acme/app", path: "src/refunds.ts" } },
  ]);
});

test("A private repository marks its Sources as team only", () => {
  const batch = pullBatch(ghRepo({ private: true }), ghPull());
  assert.equal(batch.sources?.[0].sensitivity, "team");
});

test("A pull request with no body has empty text, and one from a deleted account has no author", () => {
  const batch = pullBatch(repo, ghPull({ body: null, user: null }));
  assert.equal(batch.sources?.[0].text, "");
  assert.deepEqual(batch.people, []);
  assert.deepEqual(batch.links, []);
});

test("A pull request opened by a bot is skipped", () => {
  assert.deepEqual(pullBatch(repo, ghPull({ user: ghUser({ login: "renovate[bot]" }) })), {});
});

test("A review becomes a Message that is part of its pull request", () => {
  const batch = reviewBatch(repo, 7, ghReview());
  const source = batch.sources?.[0];
  assert.equal(source?.external_id, "acme/app/review/501");
  assert.deepEqual(source?.labels, ["Message"]);
  assert.equal(source?.title, "Review on PR #7");
  assert.equal(source?.created_at, "2026-10-02T12:00:00Z");
  assert.deepEqual(batch.links?.at(-1), {
    from: { kind: "source", connector: "github", external_id: "acme/app/review/501" },
    rel: "PART_OF",
    to: pr7,
  });
});

test("Empty, bot and authorless reviews are skipped", () => {
  assert.deepEqual(reviewBatch(repo, 7, ghReview({ body: "   " })), {});
  assert.deepEqual(reviewBatch(repo, 7, ghReview({ body: null })), {});
  assert.deepEqual(reviewBatch(repo, 7, ghReview({ user: ghUser({ type: "Bot" }) })), {});
  assert.deepEqual(reviewBatch(repo, 7, ghReview({ user: null })), {});
});

test("A deleted review keeps its deletion time", () => {
  const batch = reviewBatch(repo, 7, ghReview(), "2026-10-05T00:00:00Z");
  assert.equal(batch.sources?.[0].deleted_at, "2026-10-05T00:00:00Z");
});

test("A conversation comment is part of its pull request and touches no file", () => {
  const batch = commentBatch(repo, 7, ghComment(), "comment");
  const id = { kind: "source", connector: "github", external_id: "acme/app/comment/901" };
  assert.equal(batch.sources?.[0].title, "Comment on PR #7");
  assert.equal(batch.sources?.[0].updated_at, "2026-10-02T11:30:00Z");
  assert.deepEqual(
    batch.links?.map((l) => l.rel),
    ["AUTHORED", "PART_OF"],
  );
  assert.deepEqual(batch.links?.[1], { from: id, rel: "PART_OF", to: pr7 });
});

test("A review comment on a file names the file and touches it", () => {
  const batch = commentBatch(repo, 7, ghComment({ path: "src/refunds.ts" }), "review-comment", "2026-10-06T00:00:00Z");
  const source = batch.sources?.[0];
  assert.equal(source?.external_id, "acme/app/review-comment/901");
  assert.equal(source?.title, "Review comment on PR #7: src/refunds.ts");
  assert.equal(source?.deleted_at, "2026-10-06T00:00:00Z");
  assert.deepEqual(batch.links?.at(-1), {
    from: { kind: "source", connector: "github", external_id: "acme/app/review-comment/901" },
    rel: "TOUCHES",
    to: { kind: "codeunit", repo: "acme/app", path: "src/refunds.ts" },
  });
});

test("Comments from bots or deleted accounts are skipped, and a null body becomes empty text", () => {
  assert.deepEqual(commentBatch(repo, 7, ghComment({ user: ghUser({ login: "github-actions[bot]" }) }), "comment"), {});
  assert.deepEqual(commentBatch(repo, 7, ghComment({ user: null }), "comment"), {});
  assert.equal(commentBatch(repo, 7, ghComment({ body: null }), "comment").sources?.[0].text, "");
});

test("A commit is titled by its first line, is kept out of extraction and touches its files", () => {
  const commit: GhCommit = {
    sha: "abc123",
    html_url: "https://github.com/acme/app/commit/abc123",
    author: ghUser(),
    commit: { message: "fix: round refunds\n\nCloses BIL-12", author: { name: "Ada", date: "2026-10-03T09:00:00Z" } },
    files: [{ filename: "src/refunds.ts" }],
  };
  const batch = commitBatch(repo, commit);
  const source = batch.sources?.[0];
  assert.equal(source?.external_id, "acme/app/commit/abc123");
  assert.deepEqual(source?.labels, ["Commit"]);
  assert.equal(source?.title, "fix: round refunds");
  assert.equal(source?.text, "fix: round refunds\n\nCloses BIL-12");
  assert.equal(source?.created_at, "2026-10-03T09:00:00Z");
  assert.equal(source?.extract, false);
  assert.deepEqual(
    batch.links?.map((l) => l.rel),
    ["AUTHORED", "TOUCHES"],
  );
});

test("A commit whose author has no GitHub account has no AUTHORED link", () => {
  const batch = commitBatch(repo, {
    sha: "def456",
    html_url: "https://github.com/acme/app/commit/def456",
    author: null,
    commit: { message: "chore: bump", author: { name: "Someone", date: "2026-10-03T09:00:00Z" } },
  });
  assert.deepEqual(batch.people, []);
  assert.deepEqual(batch.links, []);
});

test("A doc links to its file on the default branch and can be marked deleted", () => {
  const batch = docBatch(repo, "docs/product.md", "# Axon", "2026-10-04T00:00:00Z", "2026-10-05T00:00:00Z");
  assert.deepEqual(batch.sources, [
    {
      connector: "github",
      external_id: "acme/app/doc/docs/product.md",
      labels: ["Doc"],
      title: "docs/product.md",
      text: "# Axon",
      url: "https://github.com/acme/app/blob/main/docs/product.md",
      created_at: "2026-10-04T00:00:00Z",
      updated_at: "2026-10-04T00:00:00Z",
      deleted_at: "2026-10-05T00:00:00Z",
      sensitivity: "public",
    },
  ]);
});

test("CODEOWNERS ownership links people to files and drops bot owners", () => {
  const batch = ownershipBatch(repo, [
    { owner: ghUser(), path: "src/refunds.ts" },
    { owner: ghUser({ login: "ci[bot]" }), path: "src/ci.ts" },
  ]);
  assert.deepEqual(batch.people, [{ connector: "github", external_id: "101", handle: "ada", name: "ada" }]);
  assert.deepEqual(batch.links, [
    {
      from: { kind: "person", connector: "github", external_id: "101", handle: "ada", name: "ada" },
      rel: "OWNS",
      to: { kind: "codeunit", repo: "acme/app", path: "src/refunds.ts" },
      props: { via: "CODEOWNERS" },
    },
  ]);
});

test("Merging batches concatenates every list and tolerates empty batches", () => {
  const merged = mergeBatches([pullBatch(repo, ghPull()), {}, reviewBatch(repo, 7, ghReview())]);
  assert.deepEqual(
    merged.sources?.map((s) => s.external_id),
    ["acme/app/pull/7", "acme/app/review/501"],
  );
  assert.equal(merged.people?.length, 2);
  assert.deepEqual(merged.projects, []);
  assert.deepEqual(merged.codeUnits, []);
});
