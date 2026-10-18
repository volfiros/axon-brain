import assert from "node:assert/strict";
import { test } from "node:test";

import { hmacHex, planeProject, planeWorkItem } from "@/tests/helpers/connector-payloads";

import type { Batch, ConnectorContext } from "../types";
import type { PlaneApi } from "./api";
import { backfillWith, planeConnector, planeEventBatches, verifyPlaneSignature } from "./index";

const SECRET = "test-plane-webhook-secret";
process.env.PLANE_WEBHOOK_SECRET = SECRET;

const body = JSON.stringify({ event: "workitem.updated", data: { id: "item-1" } });
const links = { appUrl: "https://plane.example.test", workspaceSlug: "acme" };
const ctx = { workspace: "acme" } as ConnectorContext;

async function collect(items: AsyncIterable<Batch>): Promise<Batch[]> {
  const all: Batch[] = [];
  for await (const item of items) all.push(item);
  return all;
}

test("A webhook signed with the shared secret passes", () => {
  assert.equal(verifyPlaneSignature(body, hmacHex(SECRET, body), SECRET), true);
});

test("A webhook signed with another secret fails", () => {
  assert.equal(verifyPlaneSignature(body, hmacHex("other-secret", body), SECRET), false);
});

test("A webhook whose body changed after signing fails", () => {
  assert.equal(verifyPlaneSignature(body.replace("updated", "deleted"), hmacHex(SECRET, body), SECRET), false);
});

test("A webhook with no signature, a truncated one or no secret fails", () => {
  assert.equal(verifyPlaneSignature(body, null, SECRET), false);
  assert.equal(verifyPlaneSignature(body, hmacHex(SECRET, body).slice(0, 10), SECRET), false);
  assert.equal(verifyPlaneSignature(body, hmacHex("", body), ""), false);
});

test("The connector reads the X-Plane-Signature header and the configured secret", () => {
  const request = (signature: string) =>
    new Request("https://axon.test/api/plane/webhook", { method: "POST", headers: { "X-Plane-Signature": signature }, body });
  assert.equal(planeConnector.verifyWebhook(request(hmacHex(SECRET, body)), body), true);
  assert.equal(planeConnector.verifyWebhook(request(hmacHex("other-secret", body)), body), false);
});

function fakeApi(responses: Record<string, unknown>): PlaneApi & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    async get<T>(path: string) {
      paths.push(path);
      if (!(path in responses)) throw new Error(`Plane GET ${path} failed: 404`);
      return responses[path] as T;
    },
    async *list<T>(path: string) {
      if (responses[path] instanceof Error) throw responses[path];
      paths.push(path);
      yield* ((responses[path] ?? []) as T[]);
    },
  };
}

test("Backfill yields members, then each live project with its work items and comments", async () => {
  const api = fakeApi({
    "/members/": [{ id: "wm-1", member: "user-1", display_name: "ada" }],
    "/projects/": [
      planeProject(),
      planeProject({ id: "proj-old", archived_at: "2026-01-01T00:00:00Z" }),
      planeProject({ id: "proj-secret", network: 0, identifier: "SEC" }),
    ],
    "/projects/proj-1/work-items/": [planeWorkItem()],
    "/projects/proj-1/work-items/item-1/comments/": [
      { id: "comment-1", comment_stripped: "Round up?", issue: "item-1", actor: "user-1", created_at: "2026-10-02T00:00:00Z" },
    ],
    "/projects/proj-secret/members/": [{ id: "wm-1", member: "user-1" }],
    "/projects/proj-secret/work-items/": [planeWorkItem({ id: "item-9", project: "proj-secret", sequence_id: 3 })],
  });

  const batches = await collect(backfillWith(api, ctx, links));

  assert.deepEqual(
    batches[0].people?.map((p) => p.external_id),
    ["user-1"],
  );
  assert.deepEqual(
    batches.flatMap((b) => b.projects ?? []).map((p) => p.external_id),
    ["proj-1", "proj-secret"],
  );
  const sources = batches.flatMap((b) => b.sources ?? []);
  assert.deepEqual(
    sources.map((s) => [s.external_id, s.key, s.sensitivity]),
    [
      ["item-1", "BIL-12", "team"],
      ["comment-1", undefined, "team"],
      ["item-9", "SEC-3", "restricted"],
    ],
  );
  assert.deepEqual(sources[2].visible_to, [{ connector: "plane", external_id: "user-1" }]);
  assert.equal(api.paths.includes("/projects/proj-old/work-items/"), false);
});

test("An incremental backfill stops at the first work item not updated since the resume point", async () => {
  const api = fakeApi({
    "/members/": [],
    "/projects/": [planeProject()],
    "/projects/proj-1/work-items/": [
      planeWorkItem({ id: "new", updated_at: "2026-10-05T00:00:00Z" }),
      planeWorkItem({ id: "old", updated_at: "2026-09-01T00:00:00Z" }),
      planeWorkItem({ id: "older", updated_at: "2026-08-01T00:00:00Z" }),
    ],
  });
  const batches = await collect(backfillWith(api, { ...ctx, since: "2026-10-01T00:00:00Z" }, links));
  assert.deepEqual(
    batches.flatMap((b) => b.sources ?? []).map((s) => s.external_id),
    ["new"],
  );
});

test("A project event becomes its Project, and a deleted project or one without an id yields nothing", async () => {
  const created = await collect(planeEventBatches({ event: "project.created", data: planeProject() }, ctx, links));
  assert.deepEqual(
    created.flatMap((b) => b.projects ?? []).map((p) => p.external_id),
    ["proj-1"],
  );
  assert.deepEqual(await collect(planeEventBatches({ event: "project.deleted", previous_attributes: planeProject() }, ctx, links)), []);
  assert.deepEqual(await collect(planeEventBatches({ event: "project.updated", data: {} }, ctx, links)), []);
});

test("Events Axon does not handle, and work items or comments missing ids, yield nothing", async () => {
  assert.deepEqual(await collect(planeEventBatches({ event: "cycle.created", data: { id: "c1" } }, ctx, links)), []);
  assert.deepEqual(await collect(planeEventBatches({}, ctx, links)), []);
  assert.deepEqual(await collect(planeEventBatches({ event: "workitem.updated", data: { id: "item-1" } }, ctx, links)), []);
  assert.deepEqual(
    await collect(planeEventBatches({ event: "workitem.comment.created", data: { id: "comment-1" } }, ctx, links)),
    [],
  );
});

test("Backfill reads each live page's full text, and skips archived pages and pages not updated since the resume point", async () => {
  const listed = { name: "Runbook", owned_by: "user-1", access: 0, created_at: "2026-10-01T00:00:00Z" };
  const api = fakeApi({
    "/projects/": [planeProject()],
    "/projects/proj-1/pages/": [
      { ...listed, id: "page-new", updated_at: "2026-10-05T00:00:00Z" },
      { ...listed, id: "page-old", updated_at: "2026-09-01T00:00:00Z" },
      { ...listed, id: "page-archived", updated_at: "2026-10-05T00:00:00Z", archived_at: "2026-10-05T00:00:00Z" },
    ],
    "/projects/proj-1/pages/page-new/": { id: "page-new", description_html: "<p>Restart the worker.</p>" },
  });

  const batches = await collect(backfillWith(api, { ...ctx, since: "2026-10-01T00:00:00Z" }, links));
  const docs = batches.flatMap((b) => b.sources ?? []).filter((s) => s.labels.includes("Doc"));

  assert.deepEqual(
    docs.map((s) => [s.external_id, s.text]),
    [["page-new", "Runbook\n\nRestart the worker."]],
  );
  assert.ok(!api.paths.includes("/projects/proj-1/pages/page-old/"));
});

test("A Plane without a Pages API still syncs the project's work items", async () => {
  const api = fakeApi({
    "/projects/": [planeProject()],
    "/projects/proj-1/work-items/": [planeWorkItem()],
    "/projects/proj-1/pages/": new Error("Plane GET /projects/proj-1/pages/ failed: 404"),
  });
  const batches = await collect(backfillWith(api, ctx, links));
  assert.deepEqual(
    batches.flatMap((b) => b.sources ?? []).map((s) => s.external_id),
    ["item-1"],
  );
});
