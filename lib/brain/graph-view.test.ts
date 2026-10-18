import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeContext } from "@/tests/helpers/fake-context";

import { graphView, type GraphNode, type NodeType } from "./graph-view";

function node(id: string, type: NodeType): GraphNode {
  return { id, type, kind: null, name: id, text: null, url: null, status: null };
}

type Near = { id: string; tier: number };

function viewContext(rows: { anchors?: GraphNode[]; reached?: GraphNode[]; excerpts?: GraphNode[]; near?: Near[] }) {
  return fakeContext((cypher) => {
    if (cypher.includes("MATCH (a)-[r]->(b)")) return [{ source: "dec_1", target: "src_1", type: "DERIVED_FROM" }];
    if (cypher.includes("AS tier")) return rows.near ?? [];
    if (cypher.includes("MATCH (n:Excerpt)")) return rows.excerpts ?? [];
    if (cypher.includes("MATCH (a)-[r]-(n)")) return rows.reached ?? [];
    return rows.anchors ?? [];
  });
}

test("Nodes from all three reads are merged once each and ordered by type", async () => {
  const { ctx } = viewContext({
    anchors: [node("src_1", "Source"), node("dec_1", "Decision"), node("con_1", "Constraint")],
    reached: [node("p_1", "Person"), node("dec_1", "Decision"), node("cu_1", "CodeUnit")],
    excerpts: [node("ex_1", "Excerpt")],
  });
  const view = await graphView(ctx);
  assert.deepEqual(view.nodes.map((n) => n.id), ["dec_1", "con_1", "src_1", "p_1", "cu_1", "ex_1"]);
  assert.equal(view.total, 6);
  assert.equal(view.capped, false);
  assert.deepEqual(view.edges, [{ source: "dec_1", target: "src_1", type: "DERIVED_FROM" }]);
});

test("Node reads filter by the caller and edges are read only between the nodes kept", async () => {
  const { ctx, calls } = viewContext({ anchors: [node("dec_1", "Decision"), node("src_1", "Source")] });
  await graphView(ctx);
  const [anchors, reached, excerpts, near, edges] = calls;
  for (const call of [anchors, reached, excerpts, near]) {
    assert.equal(call.params.personId, "p_caller");
    assert.ok(call.cypher.includes("VISIBLE_TO"));
  }
  assert.deepEqual(edges.params, { ids: ["dec_1", "src_1"] });
  assert.ok(calls.every((c) => c.readOnly));
});

test("The view is capped at 300 nodes with decisions kept first", async () => {
  const sources = Array.from({ length: 250 }, (_, i) => node(`src_${i}`, "Source"));
  const decisions = Array.from({ length: 100 }, (_, i) => node(`dec_${i}`, "Decision"));
  const { ctx, calls } = viewContext({ anchors: [...sources, ...decisions] });
  const view = await graphView(ctx);
  assert.equal(view.nodes.length, 300);
  assert.equal(view.total, 350);
  assert.equal(view.capped, true);
  assert.equal(view.nodes.filter((n) => n.type === "Decision").length, 100);
  assert.equal((calls[4].params.ids as string[]).length, 300);
});

test("Under the cap, a decision's quote, source, code and the PRs that changed it come before unrelated sources", async () => {
  const unrelated = Array.from({ length: 400 }, (_, i) => node(`src_${i}`, "Source"));
  const { ctx } = viewContext({
    anchors: [...unrelated, node("dec_1", "Decision"), node("doc_1", "Source"), node("pr_9", "Source")],
    reached: [node("cu_1", "CodeUnit"), node("p_1", "Person"), node("p_other", "Person")],
    excerpts: [node("ex_1", "Excerpt"), node("ex_other", "Excerpt")],
    near: [
      { id: "ex_1", tier: 1 },
      { id: "doc_1", tier: 1 },
      { id: "cu_1", tier: 1 },
      { id: "p_1", tier: 1 },
      { id: "pr_9", tier: 2 },
      { id: "doc_1", tier: 2 },
      { id: "hidden_src", tier: 1 },
    ],
  });
  const view = await graphView(ctx);
  assert.deepEqual(view.nodes.slice(0, 6).map((n) => n.id), ["dec_1", "doc_1", "p_1", "cu_1", "ex_1", "pr_9"]);
  assert.equal(view.nodes.length, 300);
  assert.ok(!view.nodes.some((n) => n.id === "hidden_src"));
  assert.ok(!view.nodes.some((n) => n.id === "ex_other" || n.id === "p_other"));
});
