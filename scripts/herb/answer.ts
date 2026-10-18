import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { searchSources, type FoundSource } from "@/lib/brain/sources";
import { formatSource } from "@/lib/brain/tools/search-sources";
import { closeConnection } from "@/lib/graph/client";

import { assertLocal, HERB_DIR, herbProducts, readProduct } from "./load";
import { benchContext } from "./retrieval";

const run = promisify(execFile);
const PER_TYPE = Number(process.env.HERB_PER_TYPE ?? 0);
const CONCURRENCY = Number(process.env.HERB_CONCURRENCY ?? 6);
const MODEL = process.env.HERB_MODEL ?? "deepseek/deepseek-chat";

async function llm(prompt: string): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    const { stdout } = await run("claude", ["-p", "--model", "haiku", prompt], { maxBuffer: 1 << 24, timeout: 180_000 });
    return stdout.trim();
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, temperature: 0, messages: [{ role: "user", content: prompt }] }),
    });
    if (res.ok) return ((await res.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content.trim();
    if (attempt >= 3) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

const FORMAT: Record<string, string> = {
  person: "a JSON array of employee IDs (like eid_1234abcd)",
  company: "a JSON array of company names",
  pr: "a JSON array of pull request links",
  url: "a JSON array of URLs",
  content: "a short answer in plain text",
};

async function queriesFor(product: string, question: string): Promise<string[]> {
  const reply = await llm(
    `You search the ${product} team's Slack, docs, meeting transcripts and pull requests with a keyword search tool.
Write up to 3 short keyword queries (3 to 6 words each) that would find the evidence for this question. Reply with a JSON array of strings only.
Question: ${question}`,
  );
  return listFrom(reply).slice(0, 3);
}

async function evidence(product: string, question: string): Promise<string> {
  const ctx = benchContext(product);
  const queries = [question, ...(await queriesFor(product, question))];
  const lists = await Promise.all(queries.map(async (q) => (await searchSources(ctx, q, { limit: 25, direct: 15 })) ?? []));
  const merged = new Map<string, FoundSource>();
  for (let i = 0; merged.size < 50 && lists.some((l) => i < l.length); i++) {
    for (const list of lists) if (list[i] && !merged.has(list[i].id) && merged.size < 50) merged.set(list[i].id, list[i]);
  }
  const text = [...merged.values()].map((s, i) => formatSource(s, queries.join(" "), i + 1)).join("\n");
  // Customers appear by id in messages; the graph's ExternalParty nodes name their company.
  const ids = [...new Set(text.match(/CUST-\d{4}/g) ?? [])];
  const customers = ids.length
    ? await ctx.graph.roQuery<{ id: string; company: string; contact: string }>(
        "UNWIND $ids AS id MATCH (x:ExternalParty {id: 'herb:' + id}) RETURN id, x.name AS company, x.contact AS contact",
        { ids },
      )
    : [];
  return [text, customers.length ? `\nCustomers mentioned:\n${customers.map((c) => `- ${c.id}: ${c.contact} at ${c.company}`).join("\n")}` : ""].join("");
}

function answerPrompt(product: string, question: string, type: string, context: string): string {
  return `You answer questions about the ${product} product team using only the Sources below, found by searching the company knowledge graph.
Answer from whatever the Sources show, even if they cover the question only in part. Reply exactly UNANSWERABLE only when no Source is about the question at all.
Product code names in the Sources may differ from the product name in the question.
Answer as ${FORMAT[type] ?? FORMAT.content}, with nothing else.

Question: ${question}

Sources:
${context}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function listFrom(answer: string): string[] {
  const json = answer.match(/\[[\s\S]*\]/)?.[0];
  try {
    if (json) return (JSON.parse(json) as unknown[]).map(String);
  } catch {}
  return answer.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

function f1(predicted: string[], truth: string[]): number {
  const p = new Set(predicted.map(norm).filter(Boolean));
  const t = new Set(truth.map(norm));
  const hit = [...p].filter((x) => t.has(x)).length;
  if (hit === 0) return 0;
  const precision = hit / p.size;
  const recall = hit / t.size;
  return (2 * precision * recall) / (precision + recall);
}

async function judge(question: string, reference: string, answer: string): Promise<number> {
  const reply = await llm(
    `Rate how well the answer matches the reference for factual accuracy and relevance, from 1 to 100. Reply with only the number.
Question: ${question}
Reference: ${reference}
Answer: ${answer}`,
  );
  return Math.min(100, Math.max(1, Number(reply.match(/\d+/)?.[0] ?? 1)));
}

type Item = { product: string; question: string; type: string; truth: string[] | string | null };
type Scored = Item & { answer: string; score: number };

async function score(item: Item): Promise<Scored> {
  const answer = await llm(answerPrompt(item.product, item.question, item.type, await evidence(item.product, item.question)));
  let value: number;
  if (item.truth === null) value = /UNANSWERABLE/i.test(answer) ? 100 : 0;
  else if (/UNANSWERABLE/i.test(answer)) value = 0;
  else if (item.type === "content") value = await judge(item.question, [item.truth].flat().join("\n"), answer);
  else value = 100 * f1(listFrom(answer), [item.truth].flat());
  return { ...item, answer, score: value };
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
        if (i % 25 === 0) console.log(`${i + 1}/${items.length}`);
      }
    }),
  );
  return out;
}

async function main() {
  assertLocal();
  let items: Item[] = herbProducts().flatMap((product) => {
    const p = readProduct(product);
    return [
      ...p.answerable_questions.map((q) => ({ product, question: q.question, type: q.type, truth: q.ground_truth })),
      ...p.unanswerable_questions.map((question) => ({ product, question, type: "unanswerable", truth: null })),
    ];
  });
  const types = process.env.HERB_TYPES?.split(",");
  if (types) items = items.filter((it) => types.includes(it.type));
  if (PER_TYPE) {
    const byType = new Map<string, Item[]>();
    items.forEach((it, i) => i % 7 === 0 && byType.set(it.type, [...(byType.get(it.type) ?? []), it]));
    items = [...byType.values()].flatMap((list) => list.slice(0, PER_TYPE));
  }
  const scored = await pool(items, CONCURRENCY, (it) =>
    score(it).catch((err) => ({ ...it, answer: `ERROR ${err instanceof Error ? err.message : err}`, score: 0 })),
  );

  const errors = scored.filter((s) => s.answer.startsWith("ERROR"));
  if (errors.length) console.log(`${errors.length} questions failed and are left out, first: ${errors[0].answer.slice(0, 200)}`);
  const answered = scored.filter((s) => !s.answer.startsWith("ERROR"));
  const summary: Record<string, { n: number; score: number }> = {};
  for (const type of new Set(answered.map((s) => s.type))) {
    const group = answered.filter((s) => s.type === type);
    summary[type] = { n: group.length, score: Number((group.reduce((a, s) => a + s.score, 0) / group.length).toFixed(1)) };
  }
  const answerable = ["content", "person", "company", "pr"].filter((t) => summary[t]);
  summary.average = { n: answerable.reduce((a, t) => a + summary[t].n, 0), score: Number((answerable.reduce((a, t) => a + summary[t].score, 0) / answerable.length).toFixed(1)) };
  console.table(summary);
  const out = join(HERB_DIR, "results");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `answers-${process.argv[2] ?? "run"}.json`), JSON.stringify({ model: process.env.OPENROUTER_API_KEY ? MODEL : "claude haiku", summary, scored }, null, 1));
  await closeConnection();
}

if (process.argv[1]?.endsWith("answer.ts")) main();
