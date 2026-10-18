import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { graphView } from "@/lib/brain/graph-view";
import type { BrainContext } from "@/lib/brain/tool";
import type { Batch, Sensitivity } from "@/lib/connectors/types";
import { writeBatch } from "@/lib/connectors/write";

import { saveItem, seedCaller } from "../helpers/brain";
import { seedWorkspace } from "../helpers/fixtures";
import { useTestGraphs } from "../helpers/graph";

useTestGraphs();

let n = 0;
let admin: BrainContext;
let guest: BrainContext;

beforeEach(async () => {
  const slug = `gv-${++n}`;
  await seedWorkspace(slug);
  admin = await seedCaller(slug, `${slug}-admin`, "Admin", "Ada Admin");
  guest = await seedCaller(slug, `${slug}-guest`, "Guest", "Gus Guest");
});

const REPO = "acme/pay";
const PATH = "src/refunds.ts";

function prs(numbers: number[], opts: { touches?: boolean; createdAt?: string; sensitivity?: Sensitivity } = {}): Batch {
  return {
    sources: numbers.map((number) => ({
      connector: "github",
      external_id: `${REPO}/pull/${number}`,
      labels: ["PR"],
      title: `PR ${number}`,
      text: "Changes refunds.",
      url: `https://github.com/${REPO}/pull/${number}`,
      created_at: opts.createdAt ?? "2026-01-01T00:00:00Z",
      sensitivity: opts.sensitivity ?? "team",
    })),
    links: opts.touches
      ? numbers.map((number) => ({
          from: { kind: "source" as const, connector: "github", external_id: `${REPO}/pull/${number}` },
          rel: "TOUCHES",
          to: { kind: "codeunit" as const, repo: REPO, path: PATH },
        }))
      : [],
  };
}

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

test("past the node cap, a decision keeps its quote, source, code and the PRs that changed that code", async () => {
  await writeBatch(admin.graph, prs([1], { touches: true }));
  const { itemId, sourceId } = await saveItem(admin, { title: "Round refunds down", statement: "Refunds round down to the cent.", affects: [PATH] });
  await writeBatch(admin.graph, prs([2], { touches: true, createdAt: later(1) }));
  await writeBatch(admin.graph, prs(Array.from({ length: 320 }, (_, i) => 1000 + i)));

  const view = await graphView(admin);
  assert.equal(view.capped, true);
  const byName = new Map(view.nodes.map((node) => [node.name, node]));
  const code = view.nodes.find((node) => node.type === "CodeUnit" && node.text === PATH);
  const excerpt = view.nodes.find((node) => node.type === "Excerpt");
  assert.ok(view.nodes.some((node) => node.id === itemId));
  assert.ok(view.nodes.some((node) => node.id === sourceId));
  assert.ok(code && excerpt && byName.has("PR 2"));

  const edge = (source: string, type: string, target: string) => view.edges.some((e) => e.source === source && e.type === type && e.target === target);
  assert.ok(edge(itemId, "DERIVED_FROM", excerpt.id));
  assert.ok(edge(excerpt.id, "IN", sourceId));
  assert.ok(edge(itemId, "AFFECTS", code.id));
  assert.ok(edge(byName.get("PR 2")!.id, "TOUCHES", code.id));
});

test("a PR the caller cannot see is not pulled in next to the decision", async () => {
  await saveItem(admin, { title: "Round refunds down", statement: "Refunds round down to the cent.", affects: [PATH] });
  await writeBatch(admin.graph, prs([3], { touches: true, createdAt: later(1), sensitivity: "restricted" }));

  assert.ok((await graphView(admin)).nodes.some((node) => node.name === "PR 3"));
  assert.ok(!(await graphView(guest)).nodes.some((node) => node.name === "PR 3"));
});

test("past the node cap, a guest gets the 5 newest PRs they can see on the decision's code, written out of order", async () => {
  await writeBatch(admin.graph, prs([0], { touches: true, sensitivity: "public" }));
  await saveItem(admin, { title: "Round refunds down", statement: "Refunds round down to the cent.", affects: [PATH], sensitivity: "public" });
  await writeBatch(admin.graph, prs(Array.from({ length: 320 }, (_, i) => 1000 + i), { sensitivity: "public" }));
  for (const number of [4, 1, 7, 3, 6, 2, 5]) await writeBatch(admin.graph, prs([number], { touches: true, createdAt: later(number), sensitivity: "public" }));
  await writeBatch(admin.graph, prs([10, 11, 12, 13, 14], { touches: true, createdAt: later(20), sensitivity: "restricted" }));

  const names = (view: { nodes: { name: string }[] }) => new Set(view.nodes.map((node) => node.name));
  const guestView = names(await graphView(guest));
  for (const number of [3, 4, 5, 6, 7]) assert.ok(guestView.has(`PR ${number}`), `PR ${number}`);
  for (const number of [1, 2, 10]) assert.ok(!guestView.has(`PR ${number}`), `PR ${number}`);
  const adminView = names(await graphView(admin));
  for (const number of [10, 11, 12, 13, 14]) assert.ok(adminView.has(`PR ${number}`), `PR ${number}`);
});
