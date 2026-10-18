import assert from "node:assert/strict";
import { test } from "node:test";

import type { SlackApi } from "@/lib/connectors/slack/api";
import { backfillWith } from "@/lib/connectors/slack";
import type { Batch } from "@/lib/connectors/types";
import { writeBatch } from "@/lib/connectors/write";
import { workspaceGraph } from "@/lib/graph/client";

import { slackMessage } from "../helpers/connectors";
import { seedWorkspace } from "../helpers/fixtures";
import { useTestGraphs } from "../helpers/graph";

useTestGraphs();

test("a resumed sync reads a newly joined channel from its start and stored channels from the resume point", async () => {
  await seedWorkspace("slack-resume");
  const graph = workspaceGraph("slack-resume");
  await writeBatch(graph, slackMessage("1760000000.000100", "Stored before the last sync"));

  const seen: Record<string, string>[] = [];
  const api: SlackApi = {
    async call<T>(method: string, params: Record<string, string> = {}) {
      if (method === "conversations.history") seen.push(params);
      const replies: Record<string, unknown> = {
        "auth.test": { url: "https://acme.slack.com" },
        "users.list": { members: [] },
        "conversations.list": {
          channels: [
            { id: "C100", name: "payments", is_member: true },
            { id: "C200", name: "decisions", is_member: true },
          ],
        },
        "conversations.history": { messages: [] },
      };
      return { ok: true, ...(replies[method] as object) } as T;
    },
  };

  const since = "2026-10-18T15:53:30Z";
  const batches: Batch[] = [];
  for await (const batch of backfillWith(api, { workspace: "slack-resume", graph, since })) batches.push(batch);

  assert.deepEqual(
    seen.map((params) => [params.channel, params.oldest]),
    [
      ["C100", String(Date.parse(since) / 1000)],
      ["C200", undefined],
    ],
  );
});
