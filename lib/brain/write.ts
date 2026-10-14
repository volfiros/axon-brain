import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Params } from "@/lib/graph/client";
import { FROM_CALLER, readAsCaller, visible } from "./access";
import { searchTerms } from "./search";
import type { BrainContext } from "./tool";

export type Sensitivity = "public" | "team" | "restricted";

export const itemFields = {
  kind: z
    .enum(["decision", "constraint", "assumption", "note"])
    .describe("decision: a choice the team made. constraint: a fact that limits choices. assumption: believed true but not verified. note: context worth keeping that is none of these."),
  title: z.string().optional().describe("Short name. Required for a decision."),
  statement: z.string().describe("The decision, constraint, assumption or note in one or two plain sentences."),
  because_ids: z.array(z.string()).default([]).describe("Ids of existing Constraints or Assumptions the decision relies on."),
  new_constraints: z.array(z.string()).default([]).describe("New constraints the decision relies on, one sentence each."),
  new_assumptions: z.array(z.string()).default([]).describe("New assumptions the decision relies on, one sentence each."),
  rejected: z
    .array(z.object({ title: z.string(), reason: z.string() }))
    .default([])
    .describe("Alternatives that were considered and rejected, with the reason."),
  affects: z.array(z.string()).default([]).describe("File paths, or names of processes, projects or work items it affects."),
  about: z.array(z.string()).default([]).describe("Topics, for example 'refunds'."),
  excerpt: z.string().describe("The words this came from, quoted exactly."),
  source_title: z.string().describe("Where the excerpt came from, for example 'Claude Code session on refund retries'."),
  source_url: z.url().optional().describe("Link to the source, if there is one."),
  sensitivity: z
    .enum(["public", "team", "restricted"])
    .optional()
    .describe("public: everyone including Guests. team: Members and Admins (default). restricted: Admins and you."),
};

const itemSchema = z.object(itemFields);
export type ItemInput = z.output<typeof itemSchema>;

export type ItemPlan = {
  input: ItemInput;
  sensitivity: Sensitivity;
  reasons: { id: string; statement: string }[];
  targets: { id: string; label: string; name: string }[];
  unmatched: string[];
  topics: string[];
  similar: { id: string; title: string; status: string }[];
};

export type SourceRef = { id: string } | { title: string; url?: string };

export type WriteOptions = {
  /** accepted (default) when the caller confirmed the item, proposed when it waits for review. */
  status?: "accepted" | "proposed";
  /** Person id for MADE_BY. Defaults to the caller; null writes no MADE_BY. */
  madeBy?: string | null;
  /** content_hash of the Source text the item was extracted from. */
  sourceHash?: string;
};

const LABELS = { decision: "Decision", constraint: "Constraint", assumption: "Assumption" } as const;

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

/** Looks up everything the item would link to, without writing. Throws on input that cannot be saved. */
export async function resolveItem(ctx: BrainContext, input: ItemInput, fallback: Sensitivity = "team"): Promise<ItemPlan> {
  if (input.kind === "decision" && !input.title) throw new Error("A decision needs a short title.");
  const isDecision = input.kind === "decision";

  const reasons = isDecision && input.because_ids.length > 0
    ? await readAsCaller<{ id: string; statement: string }>(
        ctx,
        `${FROM_CALLER}
         MATCH (c) WHERE c.id IN $ids AND (c:Constraint OR c:Assumption) AND ${visible("c")}
         RETURN c.id AS id, c.statement AS statement`,
        { ids: input.because_ids },
      )
    : [];
  const missing = input.because_ids.filter((id) => !reasons.some((r) => r.id === id));
  if (isDecision && missing.length > 0) throw new Error(`No constraint or assumption you can see has the id: ${missing.join(", ")}`);

  const lowered = input.affects.map((a) => a.toLowerCase());
  // Code units and processes carry no VISIBLE_TO edges and are open to the whole workspace; anything that has them is filtered.
  const found = lowered.length === 0 ? [] : await readAsCaller<{ id: string; label: string; name: string; keys: string[] }>(
    ctx,
    `${FROM_CALLER}
     MATCH (x)
     WHERE (x:CodeUnit OR x:Process OR x:Project OR x:WorkItem)
       AND (toLower(x.path) IN $lowered OR toLower(x.name) IN $lowered OR toLower(x.title) IN $lowered)
       AND (NOT (x)-[:VISIBLE_TO]->() OR ${visible("x")})
     RETURN x.id AS id, labels(x)[0] AS label, coalesce(x.path, x.name, x.title) AS name,
            [k IN [x.path, x.name, x.title] WHERE k IS NOT NULL | toLower(k)] AS keys`,
    { lowered },
  );
  const unmatched = input.affects.filter((a) => !found.some((t) => t.keys.includes(a.toLowerCase())));
  const targets = found.map(({ id, label, name }) => ({ id, label, name }));

  const similar = isDecision ? await similarDecisions(ctx, `${input.title} ${input.statement}`) : [];

  return {
    input,
    sensitivity: input.sensitivity ?? fallback,
    reasons,
    targets,
    unmatched,
    topics: [...new Set(input.about.map((t) => t.trim().toLowerCase()).filter(Boolean))],
    similar,
  };
}

async function similarDecisions(ctx: BrainContext, text: string) {
  const { fulltext } = searchTerms(text);
  if (!fulltext) return [];
  return readAsCaller<{ id: string; title: string; status: string }>(
    ctx,
    `${FROM_CALLER}
     CALL db.idx.fulltext.queryNodes('Decision', $q) YIELD node AS d, score
     WHERE NOT d.status IN ['superseded', 'dismissed'] AND ${visible("d")}
     RETURN d.id AS id, d.title AS title, d.status AS status
     ORDER BY score DESC LIMIT 3`,
    { q: fulltext },
  );
}

export function renderPlan(plan: ItemPlan): string {
  const { input } = plan;
  const lines = [`Kind: ${input.kind}`];
  if (input.title) lines.push(`Title: ${input.title}`);
  lines.push(`Statement: ${input.statement}`);
  const because = [
    ...plan.reasons.map((r) => `${r.statement} (${r.id})`),
    ...input.new_constraints.map((s) => `${s} (new constraint)`),
    ...input.new_assumptions.map((s) => `${s} (new assumption)`),
  ];
  if (input.kind === "decision") {
    lines.push(`Because: ${because.length ? because.join("; ") : "none given"}`);
    lines.push(`Rejected: ${input.rejected.length ? input.rejected.map((r) => `${r.title}: ${r.reason}`).join("; ") : "none given"}`);
  }
  lines.push(`Affects: ${plan.targets.length ? plan.targets.map((t) => `${t.label} ${t.name}`).join(", ") : "nothing linked"}`);
  if (plan.unmatched.length) lines.push(`Not found in the graph, will be skipped: ${plan.unmatched.join(", ")}`);
  if (plan.topics.length) lines.push(`About: ${plan.topics.join(", ")}`);
  lines.push(`Source: "${input.excerpt}" (${input.source_title}${input.source_url ? `, ${input.source_url}` : ""})`);
  lines.push(`Visible to: ${plan.sensitivity}`);
  if (plan.similar.length) {
    lines.push(
      `Similar decisions already saved (use supersede if this replaces one): ${plan.similar.map((s) => `${s.title} (${s.id}, ${s.status})`).join("; ")}`,
    );
  }
  return lines.join("\n");
}

/**
 * Writes an item through application code and returns the new node ids.
 * With an existing Source, new nodes copy that Source's VISIBLE_TO edges; otherwise they follow `sensitivity`.
 */
export async function writeItem(ctx: BrainContext, plan: ItemPlan, source: SourceRef, options: WriteOptions = {}) {
  const { input, sensitivity } = plan;
  const status = options.status ?? "accepted";
  const confirmedBy = status === "accepted" ? ctx.caller.personId : null;
  const run = (cypher: string, params: Params = {}) =>
    ctx.graph.query(cypher, { ...params, personId: ctx.caller.personId });
  const created: string[] = [];

  let sourceId: string;
  if ("id" in source) {
    sourceId = source.id;
  } else {
    sourceId = newId("src");
    await run(
      `MATCH (u:Person {id: $personId})
       CREATE (s:Source:Conversation {id: $id, title: $title, url: $url, sensitivity: $sensitivity, created_at: localdatetime()})
       CREATE (u)-[:AUTHORED]->(s)`,
      { id: sourceId, title: source.title, url: source.url ?? null, sensitivity },
    );
    created.push(sourceId);
  }
  if (input.kind === "note") {
    await run("MATCH (s:Source {id: $id}) SET s.summary = $summary", { id: sourceId, summary: input.statement });
  }

  const excerptId = newId("ex");
  await run(
    `MATCH (s:Source {id: $sourceId})
     CREATE (ex:Excerpt {id: $id, text: $text})-[:IN]->(s)`,
    { sourceId, id: excerptId, text: input.excerpt },
  );

  let itemId = sourceId;
  if (input.kind !== "note") {
    itemId = newId(input.kind === "decision" ? "dec" : input.kind === "constraint" ? "con" : "asm");
    await run(
      `MATCH (ex:Excerpt {id: $excerptId})
       CREATE (n:${LABELS[input.kind]} {id: $id, statement: $statement, sensitivity: $sensitivity, recorded_at: localdatetime(),
               extracted_by: 'agent', confirmed_by: $confirmedBy})-[:DERIVED_FROM]->(ex)`,
      { excerptId, id: itemId, statement: input.statement, sensitivity, confirmedBy },
    );
    created.push(itemId);
  }

  if (input.kind === "decision") {
    await run(
      `MATCH (d:Decision {id: $id})-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)
       SET d.title = $title, d.status = $status, d.valid_from = coalesce(s.created_at, localdatetime()),
           d.confidence = $confidence, d.source_hash = $sourceHash`,
      {
        id: itemId,
        title: input.title ?? input.statement,
        status,
        confidence: status === "accepted" ? 1.0 : null,
        sourceHash: options.sourceHash ?? null,
      },
    );
    const madeBy = options.madeBy === undefined ? ctx.caller.personId : options.madeBy;
    if (madeBy) {
      await run("MATCH (d:Decision {id: $id}), (p:Person {id: $madeBy}) CREATE (d)-[:MADE_BY]->(p)", { id: itemId, madeBy });
    }
    const newReasons = [
      ...input.new_constraints.map((statement) => ({ id: newId("con"), label: "Constraint", statement })),
      ...input.new_assumptions.map((statement) => ({ id: newId("asm"), label: "Assumption", statement })),
    ];
    for (const reason of newReasons) {
      await run(
        `MATCH (d:Decision {id: $decisionId}), (ex:Excerpt {id: $excerptId})
         CREATE (d)-[:BECAUSE_OF]->(c:${reason.label} {id: $id, statement: $statement, sensitivity: $sensitivity,
                 recorded_at: localdatetime(), extracted_by: 'agent', confirmed_by: $confirmedBy})-[:DERIVED_FROM]->(ex)`,
        { decisionId: itemId, excerptId, id: reason.id, statement: reason.statement, sensitivity, confirmedBy },
      );
      created.push(reason.id);
    }
    await run(
      `MATCH (d:Decision {id: $id})
       UNWIND $reasonIds AS reasonId
       MATCH (c {id: reasonId})
       CREATE (d)-[:BECAUSE_OF]->(c)`,
      { id: itemId, reasonIds: plan.reasons.map((r) => r.id) },
    );
    for (const alt of input.rejected) {
      await run(
        `MATCH (d:Decision {id: $decisionId})
         CREATE (d)-[:CONSIDERED]->(:Alternative {id: $id, title: $title, reason_rejected: $reason})`,
        { decisionId: itemId, id: newId("alt"), title: alt.title, reason: alt.reason },
      );
    }
  }

  const linkFrom = input.kind === "note" ? sourceId : itemId;
  const linkType = input.kind === "note" ? "ABOUT" : "AFFECTS";
  await run(
    `MATCH (n {id: $id})
     UNWIND $targetIds AS targetId
     MATCH (x {id: targetId})
     CREATE (n)-[:${linkType}]->(x)`,
    { id: linkFrom, targetIds: plan.targets.map((t) => t.id) },
  );
  if (input.kind === "decision" || input.kind === "note") {
    await run(
      `MATCH (n {id: $id})
       UNWIND $topics AS name
       MERGE (t:Topic {name: name})
       ON CREATE SET t.id = 'topic_' + replace(name, ' ', '_')
       CREATE (n)-[:ABOUT]->(t)`,
      { id: linkFrom, topics: plan.topics },
    );
  }

  if ("id" in source) {
    await run(
      `MATCH (s:Source {id: $sourceId})-[:VISIBLE_TO]->(g)
       UNWIND $ids AS nodeId
       MATCH (n {id: nodeId})
       CREATE (n)-[:VISIBLE_TO]->(g)`,
      { sourceId, ids: created },
    );
    return { itemId, sourceId, excerptId };
  }

  // Same rule as the seed: public reaches every Role, team excludes Guests, restricted is Admin only, plus the author.
  await run(
    `UNWIND $ids AS nodeId
     MATCH (n {id: nodeId}), (r:Role)
     WHERE r.name = 'Admin'
        OR (r.name = 'Member' AND n.sensitivity <> 'restricted')
        OR (r.name = 'Guest' AND n.sensitivity = 'public')
     CREATE (n)-[:VISIBLE_TO]->(r)`,
    { ids: created },
  );
  if (sensitivity === "restricted") {
    await run(
      `MATCH (u:Person {id: $personId})
       UNWIND $ids AS nodeId
       MATCH (n {id: nodeId})
       CREATE (n)-[:VISIBLE_TO]->(u)`,
      { ids: created },
    );
  }

  return { itemId, sourceId, excerptId };
}

/** Marks `oldId` superseded by `newId`. History is kept: the old Decision stays, with status and valid_to set. */
export async function supersedeDecision(ctx: BrainContext, newId: string, oldId: string): Promise<void> {
  await ctx.graph.query(
    `MATCH (new:Decision {id: $newId}), (old:Decision {id: $oldId})
     CREATE (new)-[:SUPERSEDES]->(old)
     SET old.status = 'superseded', old.valid_to = localdatetime()`,
    { newId, oldId },
  );
}
