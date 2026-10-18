import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { staleDecisions } from "@/lib/brain/stale";
import type { BrainContext } from "@/lib/brain/tool";
import graphAlgorithm from "@/lib/brain/tools/graph-algorithm";
import { hideRepositories } from "@/lib/connectors/github/connection";
import type { Batch, Sensitivity } from "@/lib/connectors/types";
import { writeBatch } from "@/lib/connectors/write";

import { callTool, saveItem, seedCaller } from "../helpers/brain";
import { slackMessage } from "../helpers/connectors";
import { seedWorkspace } from "../helpers/fixtures";
import { useTestGraphs } from "../helpers/graph";

useTestGraphs();

let n = 0;
let admin: BrainContext;
let member: BrainContext;
let guest: BrainContext;

beforeEach(async () => {
  const slug = `ins-${++n}`;
  await seedWorkspace(slug);
  admin = await seedCaller(slug, `${slug}-admin`, "Admin", "Ada Admin");
  member = await seedCaller(slug, `${slug}-member`, "Member", "Mel Member");
  guest = await seedCaller(slug, `${slug}-guest`, "Guest", "Gus Guest");
});

const PATH = "src/refunds.ts";

function pr(number: number, createdAt: string, opts: { sensitivity?: Sensitivity; text?: string; repo?: string } = {}): Batch {
  const repo = opts.repo ?? "acme/pay";
  const id = `${repo}/pull/${number}`;
  return {
    people: [{ connector: "github", external_id: "42", name: "Gil Hub" }],
    sources: [
      {
        connector: "github",
        external_id: id,
        labels: ["PR"],
        title: `PR ${number}`,
        text: opts.text ?? "Changes refunds.",
        url: `https://github.com/${id}`,
        created_at: createdAt,
        sensitivity: opts.sensitivity ?? "team",
      },
    ],
    links: [
      { from: { kind: "person", connector: "github", external_id: "42" }, rel: "AUTHORED", to: { kind: "source", connector: "github", external_id: id } },
      { from: { kind: "source", connector: "github", external_id: id }, rel: "TOUCHES", to: { kind: "codeunit", repo, path: PATH } },
    ],
  };
}

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

async function refundDecision(): Promise<string> {
  await writeBatch(admin.graph, pr(1, "2026-01-01T00:00:00Z"));
  const { itemId } = await saveItem(admin, {
    title: "Round refunds down",
    statement: "Refunds round down to the cent.",
    affects: [PATH],
  });
  return itemId;
}

describe("staleDecisions", () => {
  test("a decision goes stale after three later PRs touch its code, counting only PRs the caller can see", async () => {
    const id = await refundDecision();
    await writeBatch(admin.graph, pr(2, later(1)));
    await writeBatch(admin.graph, pr(3, later(2)));
    assert.deepEqual(await staleDecisions(admin), []);

    await writeBatch(admin.graph, pr(4, later(3), { sensitivity: "restricted" }));
    const [stale] = await staleDecisions(admin);
    assert.equal(stale.id, id);
    assert.deepEqual(stale.changes.map((c) => c.title), ["PR 4", "PR 3", "PR 2"]);
    assert.deepEqual(await staleDecisions(member), []);
  });

  test("changes made before the decision do not count", async () => {
    await refundDecision();
    for (const number of [2, 3, 4]) await writeBatch(admin.graph, pr(number, "2026-02-01T00:00:00Z"));
    assert.deepEqual(await staleDecisions(admin), []);
  });
});

describe("graph_algorithm", () => {
  const ts = "1760000000.000300";

  test("shortest_path connects a Slack message to a PR through the references between them", async () => {
    await writeBatch(admin.graph, pr(7, "2026-10-02T00:00:00Z"));
    await writeBatch(admin.graph, slackMessage(ts, "Shipped in https://github.com/acme/pay/pull/7"));
    const reply = await callTool(graphAlgorithm, { algorithm: "shortest_path", from: "Message in #payments", to: "github:acme/pay/pull/7" }, admin);
    assert.equal(reply, "1 steps:\n(Message: Message in #payments)-[REFERENCES]-(PR: PR 7)");
  });

  test("a Guest gets no path through Sources they cannot see", async () => {
    await writeBatch(admin.graph, pr(7, "2026-10-02T00:00:00Z"));
    await writeBatch(admin.graph, slackMessage(ts, "Shipped in https://github.com/acme/pay/pull/7"));
    const reply = await callTool(graphAlgorithm, { algorithm: "shortest_path", from: "Message in #payments", to: "PR 7" }, guest);
    assert.match(reply, /Nothing to analyse|Nothing you can see matches/);
  });

  test("betweenness ranks the person who bridges two otherwise separate groups first", async () => {
    await writeBatch(admin.graph, pr(7, "2026-10-02T00:00:00Z"));
    await writeBatch(admin.graph, slackMessage(ts, "Refund rounding is done"));
    await writeBatch(admin.graph, {
      people: [{ connector: "github", external_id: "42" }],
      links: [{ from: { kind: "person", connector: "github", external_id: "42" }, rel: "AUTHORED", to: { kind: "source", connector: "slack", external_id: `C100:${ts}` } }],
    });
    const reply = await callTool(graphAlgorithm, { algorithm: "betweenness" }, admin);
    assert.match(reply.split("\n")[1], /^- Gil Hub: 1\.00$/);
  });

  test("components lists a decision with no link to the rest of the work", async () => {
    await writeBatch(admin.graph, pr(7, "2026-10-02T00:00:00Z"));
    await writeBatch(admin.graph, pr(8, "2026-10-02T00:00:00Z"));
    await saveItem(admin, { title: "Use UTC everywhere", statement: "Store all times in UTC." });
    const reply = await callTool(graphAlgorithm, { algorithm: "components" }, admin);
    assert.match(reply, /groups with decisions cut off/);
    assert.match(reply, /\(Decision: Use UTC everywhere\)/);
  });
});

describe("hideRepositories", () => {
  test("hides a removed repository's Sources and their references, and leaves other repositories alone", async () => {
    await writeBatch(admin.graph, pr(7, "2026-10-02T00:00:00Z"));
    await writeBatch(admin.graph, pr(8, "2026-10-02T00:00:00Z", { repo: "acme/web" }));
    await writeBatch(admin.graph, slackMessage("1760000000.000400", "See https://github.com/acme/pay/pull/7"));

    await hideRepositories(admin.graph, ["acme/pay"]);

    const rows = await admin.graph.query<{ id: string; hidden: boolean }>(
      "MATCH (s:Source {connector: 'github'}) RETURN s.id AS id, s.deleted_at IS NOT NULL AS hidden ORDER BY id",
    );
    assert.deepEqual(rows, [
      { id: "github:acme/pay/pull/7", hidden: true },
      { id: "github:acme/web/pull/8", hidden: false },
    ]);
    const [refs] = await admin.graph.query<{ n: number }>("MATCH ()-[r:REFERENCES]->() RETURN count(r) AS n");
    assert.equal(refs.n, 0);
  });
});
