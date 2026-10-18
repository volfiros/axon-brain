import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { withScratchGraph, workspaceGraph } from "@/lib/graph/client";

import { listGraphs, useTestGraphs } from "../helpers/graph";

useTestGraphs();

describe("withScratchGraph", () => {
  test("deletes its temporary graph after the callback returns", async () => {
    let name = "";
    const result = await withScratchGraph(workspaceGraph("scratch").name, async (graph) => {
      name = graph.name;
      await graph.query("CREATE (:N {key: 'a'})");
      assert.ok((await listGraphs()).includes(name));
      return 42;
    });
    assert.equal(result, 42);
    assert.match(name, /_scratch__algo_[0-9a-f]{32}$/);
    assert.ok(!(await listGraphs()).includes(name));
  });

  test("deletes its temporary graph even when the callback throws", async () => {
    let name = "";
    await assert.rejects(
      withScratchGraph(workspaceGraph("scratch").name, async (graph) => {
        name = graph.name;
        await graph.query("CREATE (:N {key: 'a'})");
        throw new Error("algorithm failed");
      }),
      /algorithm failed/,
    );
    assert.ok(name);
    assert.ok(!(await listGraphs()).includes(name));
  });
});
