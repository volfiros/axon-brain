import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { staleDecisions } from "@/lib/brain/stale";
import type { BrainContext } from "@/lib/brain/tool";
import checkAnswer from "@/lib/brain/tools/check-answer";
import graphAlgorithm from "@/lib/brain/tools/graph-algorithm";
import knowledgeRisk from "@/lib/brain/tools/knowledge-risk";
import listQuestions from "@/lib/brain/tools/list-questions";
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

function pr(
  number: number,
  createdAt: string,
  opts: { sensitivity?: Sensitivity; text?: string; repo?: string; author?: string } = {},
): Batch {
  const repo = opts.repo ?? "acme/pay";
  const author = opts.author ?? "42";
  const id = `${repo}/pull/${number}`;
  return {
    people: [{ connector: "github", external_id: author, name: author === "42" ? "Gil Hub" : `User ${author}` }],
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
      { from: { kind: "person", connector: "github", external_id: author }, rel: "AUTHORED", to: { kind: "source", connector: "github", external_id: id } },
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
    assert.equal(reply, "1 step:\n(Message: Message in #payments)-[REFERENCES]-(PR: PR 7)");
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

describe("check_answer quotes", () => {
  test("a quote is checked word for word against the cited decision's source", async () => {
    const { itemId } = await saveItem(admin, {
      title: "Skip duplicate webhook events",
      statement: "Webhook handlers skip events already processed.",
      excerpt: "let's just drop duplicates by event id",
    });
    const ask = (quote: string) =>
      callTool(checkAnswer, { statements: [{ text: "Duplicates are dropped.", decision_ids: [itemId], quote }] }, admin);
    assert.match(await ask("drop duplicates by event id"), /Every statement is backed/);
    const wrong = await ask("drop duplicates by message id");
    assert.match(wrong, /current, quote not found/);
    assert.match(wrong, /Fix or drop/);
  });
});

describe("knowledge_risk", () => {
  test("a file one person changed has bus factor 1, and appears in that person's risk list until someone else works on it", async () => {
    await writeBatch(admin.graph, pr(7, "2026-10-02T00:00:00Z"));
    await writeBatch(admin.graph, pr(8, "2026-10-03T00:00:00Z"));
    assert.match(await callTool(knowledgeRisk, { topic: PATH }, admin), /^Bus factor for "src\/refunds.ts": 1 \(one person holds most of it\)\.\n- Gil Hub \(not on Axon\): 100%$/);
    assert.equal(await callTool(knowledgeRisk, { person: "Gil Hub" }, admin), `If Gil Hub leaves, these have no other owner or contributor:\n- CodeUnit: ${PATH}`);

    await writeBatch(admin.graph, pr(9, "2026-10-04T00:00:00Z", { author: "43" }));
    assert.equal(await callTool(knowledgeRisk, { person: "Gil Hub" }, admin), "Nothing you can see depends on Gil Hub alone.");
  });
});

describe("list_questions", () => {
  test("lists open questions the caller can see, filtered by topic", async () => {
    await admin.graph.query(
      `MATCH (admin:Role {name: 'Admin'}), (m:Role {name: 'Member'})
       CREATE (q1:Question {id: 'q_1', text: 'Should refunds over $500 need two approvers?', status: 'open', recorded_at: localdatetime()}),
              (q1)-[:VISIBLE_TO]->(m), (q1)-[:VISIBLE_TO]->(admin),
              (:Question {id: 'q_2', text: 'Which region hosts EU data?', status: 'open', recorded_at: localdatetime()})-[:VISIBLE_TO]->(admin)`,
    );
    assert.match(await callTool(listQuestions, {}, admin), /^2 open questions:/);
    assert.match(await callTool(listQuestions, { topic: "refunds" }, member), /^1 open question:\n- Should refunds over \$500 need two approvers\? \(q_1\)/);
    assert.equal(await callTool(listQuestions, { topic: "region" }, member), 'No open question you can see about "region".');
    assert.equal(await callTool(listQuestions, {}, guest), "No open questions you can see.");
  });
});
