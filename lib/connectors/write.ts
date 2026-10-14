import { createHash } from "node:crypto";

import type { AxonGraph, Params } from "@/lib/graph/client";

import type {
  Batch,
  CodeUnitInput,
  LinkInput,
  LinkRel,
  NodeRef,
  PersonRef,
  ProjectInput,
  Sensitivity,
  SourceInput,
} from "./types";

type Row = Params[string];

// Labels and relationship types cannot be query parameters, so they are checked before being spliced in.
const LABEL = /^[A-Z][A-Za-z]*$/;
const LINK_RELS = new Set<LinkRel>(["AUTHORED", "OWNS", "PART_OF", "TOUCHES"]);

export function sourceId(connector: string, externalId: string): string {
  return `${connector}:${externalId}`;
}

export function projectId(connector: string, externalId: string): string {
  return `${connector}:${externalId}`;
}

export function codeUnitId(repo: string, path: string): string {
  return path === "/" ? `cu:${repo}` : `cu:${repo}:${path}`;
}

function personKey(ref: { connector: string; external_id: string }): string {
  return `${ref.connector}:${ref.external_id}`;
}

function utc(iso: string | undefined): string | null {
  return iso ? new Date(iso).toISOString().slice(0, 19) : null;
}

function contentHash(source: SourceInput): string {
  return createHash("sha256").update(`${source.title}\n${source.text}`).digest("hex");
}

/** Upserts a Batch into a Workspace graph. Every write MERGEs on `id`, so replaying a Batch changes nothing. */
export async function writeBatch(graph: AxonGraph, batch: Batch, now = new Date().toISOString()): Promise<void> {
  const syncedAt = utc(now);
  const people = await resolvePeople(graph, [
    ...(batch.people ?? []),
    ...(batch.sources ?? []).flatMap((s) => s.visible_to ?? []),
  ]);
  await writeProjects(graph, batch.projects ?? [], syncedAt);
  await writeCodeUnits(graph, [...(batch.codeUnits ?? []), ...codeUnitsInLinks(batch.links ?? [])]);
  await writeSources(graph, batch.sources ?? [], people, syncedAt);
  await writeLinks(graph, batch.links ?? [], people);
  await refreshWorkedOn(graph, [...new Set(people.values())]);
}

async function resolvePeople(graph: AxonGraph, refs: PersonRef[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const ref of refs) {
    const key = personKey(ref);
    if (!ids.has(key)) ids.set(key, await resolvePerson(graph, ref));
  }
  return ids;
}

async function resolvePerson(graph: AxonGraph, ref: PersonRef): Promise<string> {
  const key = personKey(ref);
  const byKey = await graph.query<{ id: string }>(
    "MATCH (p:Person) WHERE $key IN p.external_ids RETURN p.id AS id LIMIT 1",
    { key },
  );
  let id = byKey[0]?.id;
  if (!id && ref.email) {
    const byEmail = await graph.query<{ id: string }>(
      "MATCH (p:Person {email: $email}) RETURN p.id AS id LIMIT 1",
      { email: ref.email },
    );
    id = byEmail[0]?.id;
  }
  // Handles are user-chosen and not unique across tools, so matching on one could hand a stranger someone's access.
  id ??= `p_${ref.connector}_${ref.external_id}`.replace(/[^A-Za-z0-9_]/g, "_");
  await graph.query(
    `MERGE (p:Person {id: $id})
     SET p.external_ids = CASE WHEN $key IN coalesce(p.external_ids, []) THEN p.external_ids
                               ELSE coalesce(p.external_ids, []) + $key END,
         p.name = coalesce(p.name, $name, $handle),
         p.handle = coalesce(p.handle, $handle),
         p.email = coalesce(p.email, $email)`,
    { id, key, name: ref.name ?? null, handle: ref.handle ?? null, email: ref.email ?? null },
  );
  return id;
}

async function writeProjects(graph: AxonGraph, projects: ProjectInput[], syncedAt: string | null) {
  if (projects.length === 0) return;
  const rows = projects.map((p) => ({
    id: projectId(p.connector, p.external_id),
    connector: p.connector,
    external_id: p.external_id,
    name: p.name,
    url: p.url ?? null,
    sensitivity: p.sensitivity,
  }));
  await graph.query(
    `UNWIND $rows AS r
     MERGE (p:Project {id: r.id})
     SET p.connector = r.connector, p.external_id = r.external_id, p.name = r.name, p.url = r.url,
         p.sensitivity = r.sensitivity, p.synced_at = localdatetime($syncedAt)`,
    { rows, syncedAt },
  );
  await applyVisibility(graph, "Project", rows.map((r) => ({ id: r.id, sensitivity: r.sensitivity, persons: [] })));
}

function codeUnitsInLinks(links: LinkInput[]): CodeUnitInput[] {
  return links
    .flatMap((l) => [l.from, l.to])
    .flatMap((ref) => (ref.kind === "codeunit" ? [ref] : []))
    .map((ref) => ({ repo: ref.repo, path: ref.path, kind: ref.path === "/" ? "repository" : "file" }));
}

async function writeCodeUnits(graph: AxonGraph, units: CodeUnitInput[]) {
  if (units.length === 0) return;
  const rows = [...new Map(units.map((u) => [codeUnitId(u.repo, u.path), u])).entries()].map(([id, u]) => ({
    id,
    repo_id: codeUnitId(u.repo, "/"),
    repo: u.repo,
    path: u.path,
    kind: u.kind,
    name: u.path.split("/").pop() ?? u.path,
  }));
  await graph.query(
    `UNWIND $rows AS r
     MERGE (repo:CodeUnit {id: r.repo_id})
     ON CREATE SET repo.kind = 'repository', repo.name = r.repo, repo.repo = r.repo, repo.path = '/'
     WITH r, repo
     WHERE r.kind = 'file'
     MERGE (f:CodeUnit {id: r.id})
     ON CREATE SET f.kind = 'file', f.name = r.name, f.repo = r.repo, f.path = r.path
     MERGE (f)-[:PART_OF]->(repo)`,
    { rows },
  );
}

async function writeSources(
  graph: AxonGraph,
  sources: SourceInput[],
  people: Map<string, string>,
  syncedAt: string | null,
) {
  const groups = new Map<string, Row[]>();
  for (const s of sources) {
    const labels = s.labels.filter((l) => l !== "Source");
    for (const label of labels) {
      if (!LABEL.test(label)) throw new Error(`Invalid Source label: ${label}`);
    }
    const key = labels.join(":");
    const rows = groups.get(key) ?? [];
    rows.push({
      id: sourceId(s.connector, s.external_id),
      connector: s.connector,
      external_id: s.external_id,
      title: s.title,
      text: s.text,
      url: s.url ?? null,
      created_at: utc(s.created_at),
      updated_at: utc(s.updated_at),
      deleted_at: utc(s.deleted_at),
      sensitivity: s.sensitivity,
      extract: s.extract ?? true,
      content_hash: contentHash(s),
    });
    groups.set(key, rows);
  }
  for (const [labels, rows] of groups) {
    const addLabels = labels ? `SET s:${labels}` : "";
    await graph.query(
      `UNWIND $rows AS r
       MERGE (s:Source {id: r.id})
       SET s.extraction = CASE
             WHEN NOT r.extract THEN 'skipped'
             WHEN r.deleted_at IS NOT NULL THEN CASE WHEN s.extraction = 'done' THEN 'done' ELSE 'skipped' END
             WHEN s.content_hash = r.content_hash THEN s.extraction
             ELSE 'pending' END
       ${addLabels}
       SET s.connector = r.connector, s.external_id = r.external_id, s.title = r.title, s.text = r.text,
           s.url = r.url, s.sensitivity = r.sensitivity, s.content_hash = r.content_hash,
           s.created_at = localdatetime(r.created_at),
           s.updated_at = CASE WHEN r.updated_at IS NULL THEN null ELSE localdatetime(r.updated_at) END,
           s.deleted_at = CASE WHEN r.deleted_at IS NULL THEN null ELSE localdatetime(r.deleted_at) END,
           s.synced_at = localdatetime($syncedAt)`,
      { rows, syncedAt },
    );
  }
  await applyVisibility(
    graph,
    "Source",
    sources.map((s) => ({
      id: sourceId(s.connector, s.external_id),
      sensitivity: s.sensitivity,
      persons: (s.visible_to ?? []).map((ref) => people.get(personKey(ref))!),
    })),
  );
}

// Matches the seed: public reaches every Role, team excludes Guest, restricted is Admin plus named Persons.
async function applyVisibility(
  graph: AxonGraph,
  label: "Source" | "Project",
  rows: { id: string; sensitivity: Sensitivity; persons: string[] }[],
) {
  if (rows.length === 0) return;
  await graph.query(
    `UNWIND $rows AS r
     MATCH (n:${label} {id: r.id})-[v:VISIBLE_TO]->()
     DELETE v`,
    { rows },
  );
  await graph.query(
    `UNWIND $rows AS r
     MATCH (n:${label} {id: r.id})
     MATCH (role:Role)
     WHERE role.name = 'Admin'
        OR (role.name = 'Member' AND r.sensitivity <> 'restricted')
        OR (role.name = 'Guest' AND r.sensitivity = 'public')
     MERGE (n)-[:VISIBLE_TO]->(role)`,
    { rows },
  );
  const pairs = rows.flatMap((r) => r.persons.map((person) => ({ id: r.id, person })));
  if (pairs.length === 0) return;
  await graph.query(
    `UNWIND $pairs AS r
     MATCH (n:${label} {id: r.id})
     MATCH (p:Person {id: r.person})
     MERGE (n)-[:VISIBLE_TO]->(p)`,
    { pairs },
  );
}

function resolveRef(ref: NodeRef, people: Map<string, string>): { label: string; id: string } | null {
  switch (ref.kind) {
    case "source":
      return { label: "Source", id: sourceId(ref.connector, ref.external_id) };
    case "project":
      return { label: "Project", id: projectId(ref.connector, ref.external_id) };
    case "codeunit":
      return { label: "CodeUnit", id: codeUnitId(ref.repo, ref.path) };
    case "person": {
      const id = people.get(personKey(ref));
      return id ? { label: "Person", id } : null;
    }
  }
}

async function writeLinks(graph: AxonGraph, links: LinkInput[], people: Map<string, string>) {
  const groups = new Map<string, Row[]>();
  for (const link of links) {
    if (!LINK_RELS.has(link.rel)) throw new Error(`Invalid link type: ${link.rel}`);
    const from = resolveRef(link.from, people);
    const to = resolveRef(link.to, people);
    if (!from || !to) throw new Error(`Link ${link.rel} refers to a Person missing from batch.people`);
    const key = `${from.label}|${link.rel}|${to.label}`;
    const rows = groups.get(key) ?? [];
    rows.push({ from: from.id, to: to.id, props: link.props ?? {} });
    groups.set(key, rows);
  }
  for (const [key, rows] of groups) {
    const [fromLabel, rel, toLabel] = key.split("|");
    await graph.query(
      `UNWIND $rows AS r
       MATCH (a:${fromLabel} {id: r.from})
       MATCH (b:${toLabel} {id: r.to})
       MERGE (a)-[e:${rel}]->(b)
       SET e += r.props`,
      { rows },
    );
  }
}

async function refreshWorkedOn(graph: AxonGraph, personIds: string[]) {
  if (personIds.length === 0) return;
  await graph.query(
    `MATCH (p:Person)-[:AUTHORED]->(s:Source)-[:TOUCHES]->(c:CodeUnit)
     WHERE p.id IN $ids AND s.deleted_at IS NULL
     WITH p, c, count(DISTINCT s) AS n, max(coalesce(s.updated_at, s.created_at)) AS last
     MERGE (p)-[w:WORKED_ON]->(c)
     SET w.count = n, w.last_at = last`,
    { ids: personIds },
  );
}
