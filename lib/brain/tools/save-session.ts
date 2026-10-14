import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireWriter } from "../caller";
import { resolveDecisionMatch, type Match, type Resolution } from "../session/dedupe";
import { redactItem, type Finding } from "../session/redact";
import { SAVE_SESSION_RULES } from "../session/template";
import { defineTool, type BrainContext } from "../tool";
import { renderPlan, resolveItem, supersedeDecision, writeItem, type ItemPlan, type Sensitivity } from "../write";

// Hard ceiling before redaction runs; redaction then rejects anything over its own per-field caps.
const text = () => z.string().max(2000);

const sessionItem = z.object({
  kind: z
    .enum(["decision", "constraint", "assumption", "question", "note"])
    .describe("decision, constraint, assumption, question (still open at the end of the session) or note (context that is none of these)."),
  title: text().optional().describe("Short name. Required for a decision."),
  statement: text().describe("One line for search, with specifics exactly as said. For a decision, include why it was chosen."),
  excerpts: z
    .array(text())
    .min(1)
    .max(3)
    .describe("1 to 3 short quotes copied word for word from the conversation, each under 300 characters."),
  because_ids: z.array(z.string()).max(10).default([]).describe("Ids of existing Constraints or Assumptions the decision relies on."),
  new_constraints: z.array(text()).max(5).default([]).describe("New constraints the decision relies on, one sentence each."),
  new_assumptions: z.array(text()).max(5).default([]).describe("New assumptions the decision relies on, one sentence each."),
  rejected: z
    .array(z.object({ title: text(), reason: text() }))
    .max(5)
    .default([])
    .describe("Alternatives that were considered and rejected, with the reason."),
  affects: z.array(text()).max(10).default([]).describe("Repo-relative file paths, or names of processes, projects or work items it affects."),
  about: z.array(text()).max(5).default([]).describe("Topics, for example 'refunds'."),
  made_by: text()
    .optional()
    .describe("Handle, name or Person id of whoever decided. Leave out when it was the person you are working with."),
  match: z
    .object({ kind: z.enum(["new", "repeat", "change"]), decision_id: z.string().optional() })
    .default({ kind: "new" })
    .describe("For a decision, after calling recall: new, repeat of decision_id, or change that replaces decision_id."),
});

type SessionItem = z.output<typeof sessionItem>;

const sessionFields = z.object({
  title: text().describe("Short title for this session, for example 'Refund retries rework'."),
  repo: text().optional().describe("Repository as owner/name."),
  branch: text().optional(),
  session_id: text().optional().describe("This coding session's id, if known. Saving again with the same id reuses the session."),
  sensitivity: z
    .enum(["public", "team", "restricted"])
    .default("team")
    .describe("public: everyone including Guests. team: Members and Admins (default). restricted: Admins and you."),
});

type SessionInput = z.output<typeof sessionFields>;

type Prepared = {
  item: SessionItem;
  sensitivity: Sensitivity;
  masked: Finding[];
  rejected: Finding[];
  problems: string[];
  plan?: ItemPlan;
  resolution?: Resolution;
  madeBy?: string;
};

const NARROWNESS: Sensitivity[] = ["public", "team", "restricted"];

function narrower(a: Sensitivity, b: Sensitivity): Sensitivity {
  return NARROWNESS.indexOf(a) >= NARROWNESS.indexOf(b) ? a : b;
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

function describeFinding(f: Finding): string {
  return `${f.field}: ${f.detail}`;
}

function topicsOf(item: SessionItem): string[] {
  return [...new Set(item.about.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

function toMatch(item: SessionItem): Match | string {
  const { kind, decision_id } = item.match;
  if (kind === "new") return { kind };
  return decision_id ? { kind, decision_id } : `match ${kind} needs a decision_id`;
}

async function findPerson(ctx: BrainContext, who: string): Promise<string | undefined> {
  const [row] = await ctx.graph.roQuery<{ id: string }>(
    `MATCH (p:Person)
     WHERE p.id = $who OR toLower(p.handle) = toLower($who) OR toLower(p.name) = toLower($who)
     RETURN p.id AS id LIMIT 1`,
    { who },
  );
  return row?.id;
}

async function prepare(ctx: BrainContext, raw: SessionItem, session: SessionInput): Promise<Prepared> {
  const { value: item, masked, rejected } = redactItem(raw);
  const prepared: Prepared = { item, sensitivity: session.sensitivity, masked, rejected, problems: [] };
  if (rejected.length > 0) return prepared;

  if (item.made_by) {
    prepared.madeBy = await findPerson(ctx, item.made_by);
    if (!prepared.madeBy) prepared.problems.push(`made_by: no teammate called ${item.made_by}`);
  }

  if (item.kind === "decision") {
    const match = toMatch(item);
    if (typeof match === "string") {
      prepared.problems.push(match);
      return prepared;
    }
    prepared.resolution = await resolveDecisionMatch(ctx, item.title ?? item.statement, match);
    if (prepared.resolution.action === "error") prepared.problems.push(prepared.resolution.reason);
    if (prepared.resolution.action === "supersede") {
      // Same rule as the supersede tool: keep the old decision's audience unless this session is narrower.
      prepared.sensitivity = narrower(session.sensitivity, prepared.resolution.sensitivity);
    }
  }
  if (item.kind === "question") return prepared;

  try {
    prepared.plan = await resolveItem(
      ctx,
      { ...item, kind: item.kind, excerpt: item.excerpts[0], source_title: session.title, sensitivity: prepared.sensitivity },
      prepared.sensitivity,
    );
  } catch (err) {
    prepared.problems.push((err as Error).message);
    return prepared;
  }
  const r = prepared.resolution;
  if (r && "decisionId" in r) prepared.plan.similar = prepared.plan.similar.filter((s) => s.id !== r.decisionId);
  return prepared;
}

function render(p: Prepared, n: number): string {
  // A rejected item may hold a secret in any field, so only the findings are echoed back.
  if (p.rejected.length) return `${n}. ${p.item.kind}: not saved. ${p.rejected.map(describeFinding).join("; ")}`;

  const lines = [`${n}. ${p.item.kind}${p.item.title ? `: ${p.item.title}` : ""}`];
  const r = p.resolution;
  if (r?.action === "link") {
    lines.push(
      r.caughtByTitle
        ? `Already saved as "${r.title}" (${r.decisionId}). This session is added as another source instead of a new decision.`
        : `Repeat of "${r.title}" (${r.decisionId}). This session is added as another source, nothing else changes.`,
    );
    if (r.status === "proposed") lines.push("That decision is still proposed. Saving accepts it, confirmed by you.");
  } else if (r?.action === "supersede") {
    lines.push(`Change: replaces "${r.title}" (${r.decisionId}). On save the old decision is marked superseded and kept as history.`);
  }
  const planned = p.plan && r?.action !== "link";
  lines.push(planned ? renderPlan(p.plan!) : `Statement: ${p.item.statement}`);
  lines.push(...p.item.excerpts.slice(planned ? 1 : 0).map((e) => `Excerpt: "${e}"`));
  if (!planned) lines.push(`Visible to: ${p.sensitivity}`);
  if (p.madeBy) lines.push(`Decided by: ${p.item.made_by}`);
  if (p.masked.length) lines.push(`Masked: ${p.masked.map(describeFinding).join("; ")}`);
  if (p.problems.length) lines.push(`Will not be saved: ${p.problems.join("; ")}`);
  return lines.join("\n");
}

/**
 * One Conversation per session and sensitivity, so items only ever copy VISIBLE_TO edges that
 * match their own sensitivity. Saving again with the same session_id reuses it.
 */
async function conversationFor(ctx: BrainContext, session: SessionInput, sensitivity: Sensitivity): Promise<string> {
  if (session.session_id) {
    const [existing] = await ctx.graph.roQuery<{ id: string }>(
      `MATCH (:Person {id: $personId})-[:AUTHORED]->(s:Source:Conversation {session_id: $sessionId, sensitivity: $sensitivity})
       RETURN s.id AS id LIMIT 1`,
      { personId: ctx.caller.personId, sessionId: session.session_id, sensitivity },
    );
    if (existing) return existing.id;
  }
  const id = newId("src");
  await ctx.graph.query(
    `MATCH (u:Person {id: $personId})
     CREATE (s:Source:Conversation {id: $id, title: $title, repo: $repo, branch: $branch, session_id: $sessionId,
             sensitivity: $sensitivity, created_at: localdatetime()})
     CREATE (u)-[:AUTHORED]->(s)
     WITH u, s
     MATCH (r:Role)
     WHERE r.name = 'Admin'
        OR (r.name = 'Member' AND s.sensitivity <> 'restricted')
        OR (r.name = 'Guest' AND s.sensitivity = 'public')
     CREATE (s)-[:VISIBLE_TO]->(r)`,
    {
      personId: ctx.caller.personId,
      id,
      title: session.title,
      repo: session.repo ?? null,
      branch: session.branch ?? null,
      sessionId: session.session_id ?? null,
      sensitivity,
    },
  );
  if (sensitivity === "restricted") {
    await ctx.graph.query(
      "MATCH (s:Source {id: $id}), (u:Person {id: $personId}) CREATE (s)-[:VISIBLE_TO]->(u)",
      { id, personId: ctx.caller.personId },
    );
  }
  return id;
}

async function addExcerpts(ctx: BrainContext, nodeId: string, sourceId: string, texts: string[]): Promise<void> {
  if (texts.length === 0) return;
  await ctx.graph.query(
    `MATCH (n {id: $nodeId}), (s:Source {id: $sourceId})
     UNWIND $excerpts AS ex
     OPTIONAL MATCH (n)-[:DERIVED_FROM]->(seen:Excerpt {text: ex.text})-[:IN]->(s)
     WITH n, s, ex, seen
     WHERE seen IS NULL
     CREATE (n)-[:DERIVED_FROM]->(:Excerpt {id: ex.id, text: ex.text})-[:IN]->(s)`,
    { nodeId, sourceId, excerpts: texts.map((text) => ({ id: newId("ex"), text })) },
  );
}

/** Finds an item an earlier save of this same Conversation already wrote, so a retry does not duplicate it. */
async function alreadySaved(ctx: BrainContext, item: SessionItem, sourceId: string): Promise<string | undefined> {
  const queries: Record<SessionItem["kind"], string> = {
    decision: "MATCH (n:Decision)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(:Source {id: $sourceId}) WHERE toLower(n.title) = toLower($title)",
    constraint: "MATCH (n:Constraint)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(:Source {id: $sourceId}) WHERE toLower(n.statement) = toLower($statement)",
    assumption: "MATCH (n:Assumption)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(:Source {id: $sourceId}) WHERE toLower(n.statement) = toLower($statement)",
    question: "MATCH (n:Question)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(:Source {id: $sourceId}) WHERE toLower(n.text) = toLower($statement)",
    note: "MATCH (n:Excerpt)-[:IN]->(:Source {id: $sourceId}) WHERE n.text = $excerpt AND NOT ()-[:DERIVED_FROM]->(n)",
  };
  const [row] = await ctx.graph.roQuery<{ id: string }>(`${queries[item.kind]} RETURN n.id AS id LIMIT 1`, {
    sourceId,
    title: item.title ?? item.statement,
    statement: item.statement,
    excerpt: item.excerpts[0],
  });
  return row?.id;
}

async function ensureSuperseded(ctx: BrainContext, decisionId: string, oldId: string): Promise<void> {
  const [row] = await ctx.graph.roQuery<{ done: number }>(
    "MATCH (:Decision {id: $decisionId})-[r:SUPERSEDES]->(:Decision {id: $oldId}) RETURN count(r) AS done",
    { decisionId, oldId },
  );
  if (!row?.done) await supersedeDecision(ctx, decisionId, oldId);
}

async function writeQuestion(ctx: BrainContext, item: SessionItem, sourceId: string, sensitivity: Sensitivity): Promise<string> {
  const id = newId("q");
  await ctx.graph.query(
    `MATCH (s:Source {id: $sourceId})
     CREATE (q:Question {id: $id, text: $text, status: 'open', sensitivity: $sensitivity, recorded_at: localdatetime(), extracted_by: 'agent'})
     CREATE (q)-[:DERIVED_FROM]->(:Excerpt {id: $excerptId, text: $excerpt})-[:IN]->(s)
     WITH s, q
     MATCH (s)-[:VISIBLE_TO]->(g)
     CREATE (q)-[:VISIBLE_TO]->(g)
     WITH DISTINCT q
     UNWIND $topics AS name
     MERGE (t:Topic {name: name})
     ON CREATE SET t.id = 'topic_' + replace(name, ' ', '_')
     CREATE (q)-[:ABOUT]->(t)`,
    { sourceId, id, text: item.statement, sensitivity, topics: topicsOf(item), excerptId: newId("ex"), excerpt: item.excerpts[0] },
  );
  await addExcerpts(ctx, id, sourceId, item.excerpts.slice(1));
  return id;
}

async function save(ctx: BrainContext, p: Prepared, sourceId: string): Promise<{ id: string; again: boolean }> {
  const { item, plan, resolution: r } = p;
  const existing = await alreadySaved(ctx, item, sourceId);
  if (existing) {
    if (item.kind !== "note") await addExcerpts(ctx, existing, sourceId, item.excerpts);
    if (r?.action === "supersede") await ensureSuperseded(ctx, existing, r.decisionId);
    return { id: existing, again: true };
  }

  if (r?.action === "link") {
    await addExcerpts(ctx, r.decisionId, sourceId, item.excerpts);
    if (r.status === "proposed") {
      await ctx.graph.query(
        `MATCH (d:Decision {id: $id}) WHERE d.status = 'proposed'
         SET d.status = 'accepted', d.confirmed_by = $personId, d.confirmed_at = localdatetime()`,
        { id: r.decisionId, personId: ctx.caller.personId },
      );
    }
    return { id: r.decisionId, again: false };
  }

  if (item.kind === "question") return { id: await writeQuestion(ctx, item, sourceId, p.sensitivity), again: false };
  const written = await writeItem(ctx, plan!, { id: sourceId }, { madeBy: p.madeBy });
  if (item.kind === "note") {
    await ctx.graph.query("MATCH (ex:Excerpt {id: $id}) SET ex.note = $note", { id: written.excerptId, note: item.statement });
    return { id: written.excerptId, again: false };
  }
  await addExcerpts(ctx, written.itemId, sourceId, item.excerpts.slice(1));
  if (r?.action === "supersede") await supersedeDecision(ctx, written.itemId, r.decisionId);
  return { id: written.itemId, again: false };
}

async function refreshSummary(ctx: BrainContext, sourceId: string): Promise<void> {
  // writeItem overwrites the Source summary with each note, so rebuild it from every note saved in this Conversation.
  const rows = await ctx.graph.roQuery<{ note: string }>(
    "MATCH (ex:Excerpt)-[:IN]->(:Source {id: $id}) WHERE ex.note IS NOT NULL RETURN DISTINCT ex.note AS note ORDER BY note",
    { id: sourceId },
  );
  await ctx.graph.query("MATCH (s:Source {id: $id}) SET s.summary = $summary", {
    id: sourceId,
    summary: rows.length ? rows.map((r) => r.note).join("\n") : null,
  });
}

export default defineTool({
  name: "save_session",
  description:
    "Saves what this coding session settled: decisions, constraints, assumptions, open questions and context notes, each with verbatim excerpts. " +
    "Never send the transcript.\n" +
    SAVE_SESSION_RULES,
  inputSchema: z.object({
    step: z.enum(["preview", "save"]).describe("preview checks and shows the items and writes nothing. save writes the confirmed items."),
    session: sessionFields,
    items: z.array(sessionItem).min(1).max(20),
  }),
  readOnly: false,
  async handler(input, ctx) {
    requireWriter(ctx.caller);
    const { value: session, rejected } = redactItem(input.session);
    if (rejected.length) {
      throw new Error(`The session details hold something that cannot be stored: ${rejected.map(describeFinding).join("; ")}`);
    }

    const prepared: Prepared[] = [];
    for (const item of input.items) prepared.push(await prepare(ctx, item, session));
    const preview = prepared.map((p, i) => render(p, i + 1)).join("\n\n");

    if (input.step === "preview") {
      return `${preview}\n\nNothing is saved yet. Show the person each statement beside its excerpts, let them edit or untick items, then call save_session with step "save" and only the confirmed items.`;
    }

    const ready = prepared.filter((p) => p.rejected.length === 0 && p.problems.length === 0);
    if (ready.length === 0) return `Nothing was saved.\n\n${preview}`;

    const conversations = new Map<Sensitivity, string>();
    const saved: string[] = [];
    for (const p of ready) {
      if (!conversations.has(p.sensitivity)) conversations.set(p.sensitivity, await conversationFor(ctx, session, p.sensitivity));
      const { id, again } = await save(ctx, p, conversations.get(p.sensitivity)!);
      const r = p.resolution;
      if (again) saved.push(`${p.item.kind} ${id} (already saved from this session)`);
      else if (p.item.kind === "note") saved.push("note on the session");
      else if (r?.action === "link") saved.push(`decision ${id} (new source added${r.status === "proposed" ? ", now accepted" : ""})`);
      else if (r?.action === "supersede") saved.push(`decision ${id} (replaces ${r.decisionId})`);
      else saved.push(`${p.item.kind} ${id}`);
    }
    for (const [, id] of conversations) await refreshSummary(ctx, id);

    const skipped = prepared.length - ready.length;
    return [
      `Saved to "${session.title}" (${[...conversations.values()].join(", ")}), confirmed by ${ctx.caller.name}: ${saved.join("; ")}.`,
      skipped ? `${skipped} item(s) were not saved, see below.` : "",
      preview,
    ]
      .filter(Boolean)
      .join("\n\n");
  },
});
