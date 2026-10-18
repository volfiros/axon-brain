import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Batch, LinkInput, PersonRef, SourceInput } from "@/lib/connectors/types";
import { writeBatch } from "@/lib/connectors/write";
import { closeConnection, workspaceGraph, type AxonGraph } from "@/lib/graph/client";
import { ensureWorkspaceSchema } from "@/lib/graph/schema";

export const HERB_DIR = join(process.cwd(), ".private", "herb");
const C = "herb";

type Employee = { employee_id: string; name: string; role: string };
type SlackItem = {
  Channel: { name: string };
  Message: { User: { userId: string; timestamp: string; text: string } };
  ThreadReplies: { userId?: string; User?: { userId: string; timestamp: string; text: string }; utterranceID?: string; id?: string; timestamp?: string; text?: string }[];
  id: string;
};
export type HerbQuestion = { question: string; ground_truth: string[] | string; citations: string[]; type: string };
export type HerbProduct = {
  slack: SlackItem[];
  documents: { content: string; date: string; author: string; document_link: string; type: string; id: string }[];
  meeting_transcripts: { transcript: string; date: string; document_type: string; participants: string[]; id: string }[];
  meeting_chats: { text: string; id: string }[];
  urls: { link: string; description: string; id: string }[];
  prs: {
    title: string;
    summary: string;
    link: string;
    number: string;
    state: string;
    merged: string;
    user: { login: string };
    created_at: string;
    reviews: { state: string; user: { login: string }; comment: string; submitted_at: string }[];
    id: string;
  }[];
  answerable_questions: HerbQuestion[];
  unanswerable_questions: string[];
};

export const herbProducts = () => readdirSync(join(HERB_DIR, "products")).map((f) => f.replace(/\.json$/, "")).sort();
export const herbSlug = (product: string) => `herb-${product.toLowerCase()}`;
export const readProduct = (product: string): HerbProduct =>
  JSON.parse(readFileSync(join(HERB_DIR, "products", `${product}.json`), "utf8"));

const clean = (id: string) => id.replace(/^'+|'+$/g, "");
const iso = (value: string) => (value.endsWith("Z") ? value : `${value}Z`);

// The benchmark must never write to a shared FalkorDB, so anything but a local server is refused.
export function assertLocal() {
  const host = process.env.FALKORDB_HOST || "localhost";
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`HERB runs only against a local FalkorDB, not ${host}`);
}

function productBatch(product: HerbProduct, employees: Map<string, Employee>): Batch {
  const people = new Map<string, PersonRef>();
  const ref = (raw: string) => {
    const id = clean(raw);
    const e = employees.get(id);
    if (!people.has(id)) people.set(id, { connector: C, external_id: id, name: e ? `${e.name} (${id}, ${e.role})` : id, handle: id });
    return { kind: "person" as const, connector: C, external_id: id };
  };
  const src = (id: string) => ({ kind: "source" as const, connector: C, external_id: id });
  const sources: SourceInput[] = [];
  const links: LinkInput[] = [];
  const add = (s: Omit<SourceInput, "connector" | "sensitivity">, author?: string) => {
    sources.push({ ...s, connector: C, sensitivity: "team" });
    if (author) links.push({ from: ref(author), rel: "AUTHORED", to: src(s.external_id) });
  };

  for (const m of product.slack) {
    const u = m.Message.User;
    const channel = `herb:${m.Channel.name}`;
    add({ external_id: m.id, labels: ["Message"], title: `#${m.Channel.name}`, text: u.text, created_at: iso(u.timestamp), channel }, u.userId);
    m.ThreadReplies.forEach((r, i) => {
      const user = r.User ?? { userId: r.userId ?? "unknown", timestamp: r.timestamp ?? u.timestamp, text: r.text ?? "" };
      const id = r.utterranceID ?? r.id ?? `${m.id}:reply:${i}`;
      add({ external_id: id, labels: ["Message"], title: `#${m.Channel.name} reply`, text: user.text, created_at: iso(user.timestamp), channel }, user.userId);
      links.push({ from: src(id), rel: "PART_OF", to: src(m.id) });
    });
  }
  for (const d of product.documents) {
    add({ external_id: d.id, labels: ["Doc"], title: `${d.type}: ${d.id}`, text: d.content, url: d.document_link, created_at: iso(d.date) }, d.author);
  }
  for (const m of product.meeting_transcripts) {
    add({ external_id: m.id, labels: ["Meeting"], title: `${m.document_type} meeting ${m.id}`, text: m.transcript, created_at: iso(m.date) });
    for (const p of m.participants) links.push({ from: ref(p), rel: "ATTENDED", to: src(m.id) });
  }
  for (const c of product.meeting_chats) {
    const at = c.text.match(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/)?.[0] ?? "2026-01-01T00:00:00";
    add({ external_id: c.id, labels: ["Message"], title: `Meeting chat ${c.id}`, text: c.text, created_at: iso(at) });
    const meeting = c.id.replace(/_chat$/, "");
    if (product.meeting_transcripts.some((m) => m.id === meeting)) links.push({ from: src(c.id), rel: "PART_OF", to: src(meeting) });
  }
  for (const u of product.urls) {
    add({ external_id: u.id, labels: ["Doc"], title: u.description, text: `${u.description}\n${u.link}`, url: u.link, created_at: "2026-01-01T00:00:00Z" });
  }
  for (const pr of product.prs) {
    const status = pr.merged === "True" ? "merged" : pr.state;
    add(
      { external_id: pr.id, labels: ["PR"], title: pr.title, text: `${pr.title}\n${pr.summary}\nState: ${status}`, url: pr.link, created_at: iso(pr.created_at) },
      pr.user.login,
    );
    pr.reviews.forEach((r, i) => {
      const id = `${pr.id}:review:${i}`;
      add({ external_id: id, labels: ["Message"], title: `Review of ${pr.title}`, text: `${r.state}: ${r.comment}`, created_at: iso(r.submitted_at ?? pr.created_at) }, r.user.login);
      links.push({ from: src(id), rel: "PART_OF", to: src(pr.id) });
    });
  }
  return { people: [...people.values()], sources, links };
}

async function seedRoles(graph: AxonGraph) {
  await graph.query(
    `MERGE (:Role {id: 'role_admin', name: 'Admin'})
     MERGE (:Role {id: 'role_member', name: 'Member'})
     MERGE (:Role {id: 'role_guest', name: 'Guest'})
     WITH 1 AS x MATCH (a:Role {name: 'Admin'})
     MERGE (p:Person {id: 'p_bench'}) SET p.name = 'Benchmark', p.account_id = 'bench'
     MERGE (p)-[:HAS_ROLE]->(a)`,
  );
}

export async function loadProduct(name: string, employees: Map<string, Employee>) {
  const graph = workspaceGraph(herbSlug(name));
  await graph.query("MATCH (n) DETACH DELETE n");
  await ensureWorkspaceSchema(graph);
  await seedRoles(graph);
  const customers: { name: string; role: string; company: string; id: string }[] = JSON.parse(
    readFileSync(join(HERB_DIR, "metadata", "customers_data.json"), "utf8"),
  );
  await graph.query(
    "UNWIND $rows AS r MERGE (x:ExternalParty {id: 'herb:' + r.id}) SET x.name = r.company, x.contact = r.name, x.role = r.role",
    { rows: customers },
  );
  const batch = productBatch(readProduct(name), employees);
  await writeBatch(graph, batch);
  return batch.sources?.length ?? 0;
}

async function main() {
  assertLocal();
  const employees = new Map<string, Employee>(
    Object.entries(JSON.parse(readFileSync(join(HERB_DIR, "metadata", "employee.json"), "utf8"))),
  );
  const wanted = process.argv.slice(2);
  for (const name of wanted.length ? wanted : herbProducts()) {
    const started = Date.now();
    const count = await loadProduct(name, employees);
    console.log(`${name}: ${count} sources in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  await closeConnection();
}

if (process.argv[1]?.endsWith("load.ts")) main();
