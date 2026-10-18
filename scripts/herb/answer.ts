import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { searchSources, type FoundSource } from "@/lib/brain/sources";
import searchSourcesTool, { formatSource } from "@/lib/brain/tools/search-sources";
import type { BrainContext } from "@/lib/brain/tool";
import { closeConnection } from "@/lib/graph/client";

import { assertLocal, HERB_DIR, herbProducts, readProduct } from "./load";
import { benchContext } from "./retrieval";

const run = promisify(execFile);
const PER_TYPE = Number(process.env.HERB_PER_TYPE ?? 0);
const CONCURRENCY = Number(process.env.HERB_CONCURRENCY ?? 6);
const MODEL = process.env.HERB_MODEL ?? "deepseek/deepseek-v4-pro";

type Message = { role: string; content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string };

async function complete(messages: Message[], tools?: unknown[]): Promise<Message> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, temperature: 0, messages, ...(tools ? { tools } : {}) }),
    });
    if (res.ok) {
      const message = ((await res.json()) as { choices?: { message: Message }[] }).choices?.[0]?.message;
      if (message) return message;
    }
    if (attempt >= 3) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

export async function llm(prompt: string): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) {
    const { stdout } = await run("claude", ["-p", "--model", "haiku", prompt], { maxBuffer: 1 << 24, timeout: 180_000 });
    return stdout.trim();
  }
  return ((await complete([{ role: "user", content: prompt }])).content ?? "").trim();
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

const ROUNDS = Number(process.env.HERB_ROUNDS ?? 1);

async function evidence(product: string, question: string): Promise<string> {
  const ctx = benchContext(product);
  const queries = [question, ...(await queriesFor(product, question))];
  const merged = new Map<string, FoundSource>();
  const search = async (qs: string[], cap: number) => {
    const lists = await Promise.all(qs.map(async (q) => (await searchSources(ctx, q, { limit: 25, direct: 15 })) ?? []));
    for (let i = 0; merged.size < cap && lists.some((l) => i < l.length); i++) {
      for (const list of lists) if (list[i] && !merged.has(list[i].id) && merged.size < cap) merged.set(list[i].id, list[i]);
    }
  };
  await search(queries, 40);
  if (ROUNDS > 1) {
    const seen = [...merged.values()].map((s, i) => formatSource(s, queries.join(" "), i + 1)).join("\n");
    // A second round lets the agent follow what it found, such as task names from a planning meeting to the PRs that built them.
    const follow = listFrom(
      await llm(
        `You are searching the ${product} team's Slack, docs, meetings and pull requests to answer: ${question}
Here is what the first search found. Write up to 3 new short keyword queries (3 to 6 words) for evidence still missing, for example the exact task or PR titles this evidence names. Reply with a JSON array of strings only.

${seen.slice(0, 24000)}`,
      ),
    ).slice(0, 3);
    queries.push(...follow);
    await search(follow, 60);
  }
  const text = [...merged.values()].map((s, i) => formatSource(s, queries.join(" "), i + 1)).join("\n");
  return text + (await customersIn(ctx, text));
}

// Customers appear by id in messages; the graph's ExternalParty nodes name their company.
async function customersIn(ctx: BrainContext, text: string): Promise<string> {
  const ids = [...new Set(text.match(/CUST-\d{4}/g) ?? [])];
  if (!ids.length) return "";
  const customers = await ctx.graph.roQuery<{ id: string; company: string; contact: string }>(
    "UNWIND $ids AS id MATCH (x:ExternalParty {id: 'herb:' + id}) RETURN id, x.name AS company, x.contact AS contact",
    { ids },
  );
  return customers.length ? `\nCustomers mentioned:\n${customers.map((c) => `- ${c.id}: ${c.contact} at ${c.company}`).join("\n")}` : "";
}

const STEPS = Number(process.env.HERB_STEPS ?? 0);
const searchTool = {
  type: "function",
  function: { name: searchSourcesTool.name, description: searchSourcesTool.description, parameters: z.toJSONSchema(searchSourcesTool.inputSchema) },
};

// The way a teammate's agent uses Axon: it calls the MCP tool search_sources as often as it needs, then answers.
async function agentAnswer(item: Item): Promise<string> {
  const ctx = benchContext(item.product);
  const messages: Message[] = [
    {
      role: "user",
      content: `You answer questions about the ${item.product} product team from its company knowledge graph, which you read with the search_sources tool (Slack messages, docs, meeting transcripts, pull requests with their reviews).
Search several times with different words: the question's key terms, then names, ids, task or PR titles and phrases the results reveal. Results list each person as "Name (employee id, role)".
Product code names in the Sources may differ from the product name in the question.
When you have enough, reply with the answer as ${FORMAT[item.type] ?? FORMAT.content}, with nothing else. Answer from whatever the Sources show, even in part. Reply exactly UNANSWERABLE only when nothing found is about the question.

Question: ${item.question}`,
    },
  ];
  for (let step = 0; step < STEPS; step++) {
    const reply = await complete(messages, [searchTool]);
    messages.push(reply);
    if (!reply.tool_calls?.length) return (reply.content ?? "").trim();
    for (const call of reply.tool_calls) {
      let content: string;
      try {
        const input = searchSourcesTool.inputSchema.parse(JSON.parse(call.function.arguments));
        content = await searchSourcesTool.handler(input, ctx);
        content += await customersIn(ctx, content);
      } catch (err) {
        content = `Tool error: ${err instanceof Error ? err.message : err}`;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  messages.push({ role: "user", content: `Searching is over. Reply now with the answer as ${FORMAT[item.type] ?? FORMAT.content}, or UNANSWERABLE.` });
  return ((await complete(messages)).content ?? "").trim();
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
  const answer = STEPS
    ? await agentAnswer(item)
    : await llm(answerPrompt(item.product, item.question, item.type, await evidence(item.product, item.question)));
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
  const file = join(HERB_DIR, "results", `answers-${process.argv[2] ?? "run"}.json`);
  // A re-run keeps the answers a previous run of the same label already scored and asks only the rest.
  const done = new Map<string, Scored>(
    existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).scored as Scored[]).filter((s) => !s.answer.startsWith("ERROR")).map((s) => [`${s.product}\n${s.question}`, s]) : [],
  );
  const scored = await pool(items, CONCURRENCY, async (it): Promise<Scored> =>
    done.get(`${it.product}\n${it.question}`) ??
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
  mkdirSync(join(HERB_DIR, "results"), { recursive: true });
  writeFileSync(file, JSON.stringify({ model: process.env.OPENROUTER_API_KEY ? MODEL : "claude haiku", summary, scored: answered }, null, 1));
  await closeConnection();
}

if (process.argv[1]?.endsWith("answer.ts")) main();
