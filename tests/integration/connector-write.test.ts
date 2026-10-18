import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { Batch, SourceInput } from "@/lib/connectors/types";
import { writeBatch } from "@/lib/connectors/write";
import { workspaceGraph, type AxonGraph } from "@/lib/graph/client";

import { slackMessage, slackUser } from "../helpers/connectors";
import { seedWorkspace } from "../helpers/fixtures";
import { useTestGraphs } from "../helpers/graph";

useTestGraphs();

let n = 0;
let graph: AxonGraph;

beforeEach(async () => {
  const slug = `conn-${++n}`;
  await seedWorkspace(slug);
  graph = workspaceGraph(slug);
});

const NOW = "2026-10-05T12:00:00Z";
const planeUser = { connector: "plane", external_id: "u-1", name: "Pia Plane", email: "pia@acme.test" };

const workItem: SourceInput = {
  connector: "plane",
  external_id: "wi-1",
  labels: ["WorkItem"],
  title: "Refund approvals for large amounts",
  text: "Discussed in https://acme.slack.com/archives/C100/p1760000000000300",
  url: "https://plane.acme.test/acme/projects/p/issues/wi-1",
  created_at: "2026-10-01T08:00:00Z",
  sensitivity: "team",
  key: "BIL-1",
};

function planeBatch(): Batch {
  return {
    projects: [{ connector: "plane", external_id: "proj-1", name: "Billing", sensitivity: "team", key: "BIL" }],
    people: [planeUser],
    sources: [workItem],
    links: [
      { from: { kind: "source", connector: "plane", external_id: "wi-1" }, rel: "PART_OF", to: { kind: "project", connector: "plane", external_id: "proj-1" } },
      { from: { kind: "person", connector: "plane", external_id: "u-1" }, rel: "AUTHORED", to: { kind: "source", connector: "plane", external_id: "wi-1" } },
      { from: { kind: "person", connector: "plane", external_id: "u-1" }, rel: "OWNS", to: { kind: "source", connector: "plane", external_id: "wi-1" } },
    ],
  };
}

function pullRequest(branch?: string): Batch {
  const pr: SourceInput = {
    connector: "github",
    external_id: "acme/pay/pull/7",
    labels: ["PR"],
    title: "Add a second approver to refunds",
    text: "Implements the approval rule.",
    url: "https://github.com/acme/pay/pull/7",
    created_at: "2026-10-02T08:00:00Z",
    sensitivity: "team",
    branch,
  };
  const author = { connector: "github", external_id: "42", name: "Gil Hub" };
  return {
    people: [author],
    sources: [pr],
    links: [
      { from: { kind: "person", ...author }, rel: "AUTHORED", to: { kind: "source", connector: "github", external_id: pr.external_id } },
      { from: { kind: "source", connector: "github", external_id: pr.external_id }, rel: "TOUCHES", to: { kind: "codeunit", repo: "acme/pay", path: "src/refunds.ts" } },
    ],
  };
}

const slackTs = "1760000000.000300";
const slackId = `slack:C100:${slackTs}`;

function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (v !== null && typeof v === "object" && !Array.isArray(v) && v.constructor !== Object ? String(v) : v));
}

async function snapshot(g: AxonGraph): Promise<{ nodes: string[]; edges: string[] }> {
  const nodes = await g.query<{ labels: string[]; props: unknown }>("MATCH (n) RETURN labels(n) AS labels, properties(n) AS props");
  const edges = await g.query<{ from: string; type: string; to: string; props: unknown }>(
    "MATCH (a)-[r]->(b) RETURN a.id AS from, type(r) AS type, b.id AS to, properties(r) AS props",
  );
  return { nodes: nodes.map((r) => stringify(r)).sort(), edges: edges.map((r) => stringify(r)).sort() };
}

async function references(g: AxonGraph): Promise<{ from: string; to: string; methods: string[] }[]> {
  return g.query("MATCH (a:Source)-[r:REFERENCES]->(b:Source) RETURN a.id AS from, b.id AS to, r.methods AS methods ORDER BY from, to");
}

describe("writeBatch", () => {
  test("writing the same batches twice leaves the same graph", async () => {
    const batches = [planeBatch(), pullRequest(), slackMessage(slackTs, "Shipping BIL-1 this week")];
    for (const b of batches) await writeBatch(graph, b, NOW);
    const first = await snapshot(graph);
    for (const b of batches) await writeBatch(graph, b, NOW);
    assert.deepEqual(await snapshot(graph), first);
    assert.ok(first.edges.some((e) => e.includes('"type":"REFERENCES"')));
  });

  test("replaying a PR batch leaves the graph unchanged", async () => {
    await writeBatch(graph, pullRequest("feat/bil-1-second-approver"), NOW);
    const first = await snapshot(graph);
    await writeBatch(graph, pullRequest("feat/bil-1-second-approver"), NOW);
    assert.deepEqual(await snapshot(graph), first);
  });

  test("references resolve across connectors whichever Source is written first", async () => {
    await writeBatch(graph, slackMessage(slackTs, "Shipping bil-1 this week"), NOW);
    assert.deepEqual(await references(graph), []);
    await writeBatch(graph, planeBatch(), NOW);
    await writeBatch(graph, pullRequest("feat/bil-1-second-approver"), NOW);
    assert.deepEqual(await references(graph), [
      { from: "github:acme/pay/pull/7", to: "plane:wi-1", methods: ["branch"] },
      { from: "plane:wi-1", to: slackId, methods: ["url"] },
      { from: slackId, to: "plane:wi-1", methods: ["key"] },
    ]);
  });

  test("a PR written before its work item links to it by branch name", async () => {
    await writeBatch(graph, pullRequest("feat/bil-1-second-approver"), NOW);
    await writeBatch(graph, planeBatch(), NOW);
    assert.deepEqual(await references(graph), [{ from: "github:acme/pay/pull/7", to: "plane:wi-1", methods: ["branch"] }]);
  });

  test("a Slack message that pastes a Plane page link references that page", async () => {
    const pageId = "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0";
    const pageUrl = `https://plane.acme.test/acme/projects/11111111-2222-3333-4444-555555555555/pages/${pageId}`;
    await writeBatch(
      graph,
      { sources: [{ connector: "plane", external_id: pageId, labels: ["Doc"], title: "ADR-002", text: "Require human approval", url: pageUrl, created_at: "2026-10-01T08:00:00Z", sensitivity: "team" }] },
      NOW,
    );
    await writeBatch(graph, slackMessage(slackTs, `See <${pageUrl}|ADR-002>`), NOW);
    assert.deepEqual(await references(graph), [{ from: slackId, to: `plane:${pageId}`, methods: ["url"] }]);
  });

  test("a deleted Source drops its outgoing references", async () => {
    await writeBatch(graph, planeBatch(), NOW);
    await writeBatch(graph, slackMessage(slackTs, "Shipping BIL-1 this week"), NOW);
    assert.ok((await references(graph)).some((r) => r.from === slackId));
    await writeBatch(graph, slackMessage(slackTs, "Shipping BIL-1 this week", { deleted_at: "2026-10-04T08:00:00Z" }), NOW);
    assert.ok(!(await references(graph)).some((r) => r.from === slackId));
    const [row] = await graph.query<{ deleted: boolean }>("MATCH (s:Source {id: $id}) RETURN s.deleted_at IS NOT NULL AS deleted", { id: slackId });
    assert.equal(row.deleted, true);
  });

  test("an edit that removes a reference removes its edge", async () => {
    await writeBatch(graph, planeBatch(), NOW);
    await writeBatch(graph, slackMessage(slackTs, "Shipping BIL-1 this week"), NOW);
    await writeBatch(graph, slackMessage(slackTs, "Shipping next week", { updated_at: "2026-10-04T08:00:00Z" }), NOW);
    assert.ok(!(await references(graph)).some((r) => r.from === slackId));
  });

  test("keys inside code are not references", async () => {
    await writeBatch(graph, planeBatch(), NOW);
    await writeBatch(graph, slackMessage(slackTs, "Example: `BIL-1` is a key"), NOW);
    assert.ok(!(await references(graph)).some((r) => r.from === slackId));
  });

  test("a restricted Source is visible to the Admin Role and the named people only, and widening it rewrites that", async () => {
    const restricted = slackMessage(slackTs, "Private channel note", { sensitivity: "restricted", visible_to: [slackUser] });
    await writeBatch(graph, restricted, NOW);
    const audience = () =>
      graph.query<{ name: string }>(
        "MATCH (:Source {id: $id})-[:VISIBLE_TO]->(x) RETURN coalesce(x.name, x.id) AS name ORDER BY name",
        { id: slackId },
      );
    assert.deepEqual((await audience()).map((r) => r.name), ["Admin", "Sam Slack"]);
    await writeBatch(graph, slackMessage(slackTs, "Private channel note", { sensitivity: "team" }), NOW);
    assert.deepEqual((await audience()).map((r) => r.name), ["Admin", "Member"]);
  });

  test("a Person seen in two tools with the same email becomes one Person", async () => {
    await writeBatch(graph, planeBatch(), NOW);
    await writeBatch(graph, { people: [{ connector: "slack", external_id: "U200", name: "Pia S", email: "pia@acme.test" }] }, NOW);
    const rows = await graph.query<{ ids: string[] }>("MATCH (p:Person {email: 'pia@acme.test'}) RETURN p.external_ids AS ids");
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].ids, ["plane:u-1", "slack:U200"]);
  });
});
