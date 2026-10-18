import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { searchSources } from "@/lib/brain/sources";
import type { BrainContext } from "@/lib/brain/tool";
import { closeConnection, workspaceGraph } from "@/lib/graph/client";

import { assertLocal, HERB_DIR, herbId, herbProducts, herbSlug, readProduct } from "./load";

const KS = [10, 20, 50];
const OPTIONS = JSON.parse(process.env.HERB_SEARCH ?? "{}");
const RANDOM = process.env.HERB_RANDOM === "1";

export function benchContext(product: string): BrainContext {
  const slug = herbSlug(product);
  return {
    graph: workspaceGraph(slug),
    caller: { personId: "p_bench", name: "Benchmark", role: "Admin", teams: [], workspace: slug },
  } as BrainContext;
}

type Row = { product: string; type: string; hit: Record<number, number>; recall: Record<number, number> };

async function main() {
  assertLocal();
  const label = process.argv[2] ?? "run";
  const rows: Row[] = [];
  for (const product of herbProducts()) {
    const ctx = benchContext(product);
    for (const q of readProduct(product).answerable_questions) {
      const found = RANDOM
        ? (await ctx.graph.roQuery<{ externalId: string }>("MATCH (s:Source) RETURN s.external_id AS externalId")).sort(() => Math.random() - 0.5)
        : ((await searchSources(ctx, q.question, { ...OPTIONS, limit: Math.max(...KS) })) ?? []);
      const cited = new Set(q.citations);
      const row: Row = { product, type: q.type, hit: {}, recall: {} };
      for (const k of KS) {
        const got = found.slice(0, k).filter((s) => cited.has(herbId(s.externalId))).length;
        row.hit[k] = got > 0 ? 1 : 0;
        row.recall[k] = got / Math.min(cited.size, k);
      }
      rows.push(row);
    }
  }

  const summary: Record<string, Record<string, number>> = {};
  for (const type of ["all", ...new Set(rows.map((r) => r.type))]) {
    const group = rows.filter((r) => type === "all" || r.type === type);
    const mean = (f: (r: Row) => number) => Number(((100 * group.reduce((s, r) => s + f(r), 0)) / group.length).toFixed(1));
    summary[type] = { n: group.length, ...Object.fromEntries(KS.flatMap((k) => [[`hit@${k}`, mean((r) => r.hit[k])], [`recall@${k}`, mean((r) => r.recall[k])]])) };
  }
  console.table(summary);
  const out = join(HERB_DIR, "results");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `retrieval-${label}.json`), JSON.stringify({ summary, rows }, null, 1));
  await closeConnection();
}

if (process.argv[1]?.endsWith("retrieval.ts")) main();
