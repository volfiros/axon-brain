import assert from "node:assert/strict";
import { test } from "node:test";

import { findReferences, parseUrl, refKey, type ScanSource } from "./links";

function source(text: string, extra: Partial<ScanSource> = {}): ScanSource {
  return { id: "slack:C1:1.0", connector: "slack", external_id: "C1:1.0", title: "", text, ...extra };
}

function keys(s: ScanSource): string[] {
  return findReferences(s).map((f) => `${f.method} ${refKey(f.ref)}`);
}

const PR = { id: "github:acme/app/pull/7", connector: "github", external_id: "acme/app/pull/7", title: "PR #7: Fix refunds" };

test("GitHub pull and issue URLs share one key and keep the repository's case", () => {
  assert.deepEqual(parseUrl("https://github.com/Acme/App/pull/12/files"), { kind: "pull", repo: "Acme/App", number: 12 });
  assert.deepEqual(parseUrl("https://github.com/acme/app/issues/12#issuecomment-1"), { kind: "pull", repo: "acme/app", number: 12 });
});

test("GitHub commit URLs, including commits inside a PR", () => {
  assert.deepEqual(parseUrl("https://github.com/acme/app/commit/ABC1234"), { kind: "commit", repo: "acme/app", sha: "abc1234" });
  assert.deepEqual(parseUrl("https://github.com/acme/app/pull/3/commits/abc1234def"), {
    kind: "commit",
    repo: "acme/app",
    sha: "abc1234def",
  });
  assert.equal(parseUrl("https://github.com/acme/app/commit/nothex"), null);
});

test("GitHub tree URLs keep the branch and path", () => {
  assert.deepEqual(parseUrl("https://github.com/acme/app/tree/feat/bil-1/docs"), { kind: "tree", repo: "acme/app", rest: "feat/bil-1/docs" });
});

test("A tree URL with invalid percent-encoding is skipped instead of throwing", () => {
  assert.equal(parseUrl("https://github.com/acme/app/tree/100%-done"), null);
  assert.deepEqual(keys(source("See https://github.com/acme/app/tree/100%-done and BIL-2")), ["key key:BIL-2"]);
});

test("Plane work-item and browse URLs", () => {
  const id = "c3000000-0000-4000-8000-000000000001";
  const project = "b2000000-0000-4000-8000-000000000001";
  assert.deepEqual(parseUrl(`https://plane.example/tallyroll/projects/${project}/issues/${id}`), { kind: "workitem", id, host: "plane.example" });
  assert.deepEqual(parseUrl(`https://app.plane.so/ws/projects/${project}/work-items/${id}/`), { kind: "workitem", id, host: "app.plane.so" });
  assert.deepEqual(parseUrl("https://app.plane.so/ws/browse/bil-4/"), { kind: "key", key: "BIL-4", host: "app.plane.so" });
});

test("Slack permalinks, with and without a thread", () => {
  assert.deepEqual(parseUrl("https://tallyroll.slack.example/archives/C01BILLING/p1791500000000200"), {
    kind: "slack",
    channel: "C01BILLING",
    ts: "1791500000.000200",
    host: "tallyroll.slack.example",
  });
  assert.deepEqual(parseUrl("https://x.slack.com/archives/C01/p1791500300000400?thread_ts=1791500000.000200&cid=C01"), {
    kind: "slack",
    channel: "C01",
    ts: "1791500300.000400",
    host: "x.slack.com",
  });
});

test("Slack link markup and trailing punctuation are not part of the URL", () => {
  assert.deepEqual(keys(source("See <https://github.com/acme/app/pull/9|the PR>.")), ["url pull:acme/app/9"]);
  assert.deepEqual(keys(source("Shipped in https://github.com/acme/app/pull/9.")), ["url pull:acme/app/9"]);
});

test("Work-item keys match case-insensitively at word boundaries", () => {
  assert.deepEqual(keys(source("Tracking in BIL-12, see also eu-4")), ["key key:BIL-12", "key key:EU-4"]);
  assert.deepEqual(keys(source("BIL-12x and 2BIL-12 and BIL-")), []);
});

test("Keys in a PR branch name use the branch method", () => {
  assert.deepEqual(keys({ ...PR, text: "", branch: "volfiros/bil-1-refund-hold" }), ["branch key:BIL-1"]);
});

test("Keys and URLs inside code are ignored", () => {
  const text = "Real one: BIL-2\n```\nconst example = 'BIL-99';\nhttps://github.com/acme/app/pull/5\n```\nand `EU-7` inline";
  assert.deepEqual(keys(source(text)), ["key key:BIL-2"]);
});

test("Bare SHAs resolve only inside GitHub Sources and need a digit and a letter", () => {
  assert.deepEqual(keys({ ...PR, text: "Reverts 9f3e2a1b and keeps defaced 1234567" }), ["sha commit:acme/app/9f3e2a1b"]);
  assert.deepEqual(keys(source("Reverts 9f3e2a1b")), []);
});

test("A SHA inside a URL is not counted twice", () => {
  assert.deepEqual(keys({ ...PR, text: "https://github.com/acme/app/commit/9f3e2a1b" }), ["url commit:acme/app/9f3e2a1b"]);
});

test("Names and plain wording never become references", () => {
  assert.deepEqual(keys(source("The refund hold work item that Maya owns, in the Billing project")), []);
});

test("A deleted Source references nothing", () => {
  assert.deepEqual(keys(source("Tracking in BIL-12", { deleted: true })), []);
});
