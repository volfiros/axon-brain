import type { AxonGraph } from "@/lib/graph/client";

import type { Batch } from "./types";
import { projectId, sourceId } from "./write";

/** How a reference was found: a URL, a work-item key in text, a bare commit SHA, or a key in a PR's branch name. */
export type Method = "url" | "key" | "sha" | "branch";

export type Reference =
  | { kind: "pull"; repo: string; number: number }
  | { kind: "commit"; repo: string; sha: string }
  | { kind: "tree"; repo: string; rest: string }
  | { kind: "workitem"; id: string; host: string }
  | { kind: "key"; key: string; host?: string }
  | { kind: "slack"; channel: string; ts: string; host: string };

export type Found = { ref: Reference; method: Method };

export type ScanSource = {
  id: string;
  connector: string;
  external_id: string;
  title: string;
  text: string;
  branch?: string | null;
  deleted?: boolean;
};

// Slack wraps links as <url|label>, so `|` and `>` end a URL.
const URL = /https?:\/\/[^\s<>"'`|)\]]+/gi;
const FENCED = /```[\s\S]*?```/g;
const INLINE = /`[^`\n]*`/g;
const KEY = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{0,9}-\d+)(?![A-Za-z0-9])/g;
const SHA = /(?<![A-Za-z0-9])[0-9a-f]{7,40}(?![A-Za-z0-9])/gi;
const HEX = /^[0-9a-f]{7,40}$/i;
const PLANE_ITEM = /\/projects\/[0-9a-f-]{36}\/(?:issues|work-items|pages)\/([0-9a-f-]{36})(?:[/?#]|$)/i;
const PLANE_BROWSE = /\/browse\/([A-Za-z][A-Za-z0-9]{0,9}-\d+)(?:[/?#]|$)/i;
const SLACK_PERMALINK = /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})(?:[/?#]|$)/;
const CANDIDATE_LIMIT = 500;

export function refKey(ref: Reference): string {
  switch (ref.kind) {
    case "pull":
      return `pull:${ref.repo}/${ref.number}`;
    case "commit":
      return `commit:${ref.repo}/${ref.sha}`;
    case "tree":
      return `tree:${ref.repo}/${ref.rest}`;
    case "workitem":
      return `workitem:${ref.id}@${ref.host}`;
    case "key":
      return ref.host ? `key:${ref.key}@${ref.host}` : `key:${ref.key}`;
    case "slack":
      return `slack:${ref.channel}:${ref.ts}@${ref.host}`;
  }
}

function githubRepo(source: ScanSource): string | null {
  if (source.connector !== "github") return null;
  const [owner, repo] = source.external_id.split("/");
  return owner && repo ? `${owner}/${repo}` : null;
}

function hostOf(url: string | null): string | null {
  try {
    return url ? new globalThis.URL(url).host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Text with fenced and inline code removed, since code often quotes keys and URLs as examples. */
export function withoutCode(text: string): string {
  return text.replace(FENCED, " ").replace(INLINE, " ");
}

/**
 * Parses one URL into a reference Axon can resolve, or null.
 * Repository names keep the URL's case so resolution can match Source ids exactly through the id index.
 */
export function parseUrl(raw: string): Reference | null {
  let url: URL;
  try {
    url = new globalThis.URL(raw.replace(/[.,;:!?'*_~]+$/, ""));
  } catch {
    return null;
  }
  const host = url.host.toLowerCase();
  if (host === "github.com" || host === "www.github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const [owner, repo, type, id, sub, subId] = parts;
    if (!owner || !repo || !type || !id) return null;
    const full = `${owner}/${repo}`;
    if ((type === "pull" || type === "issues") && /^\d+$/.test(id)) {
      if (type === "pull" && sub === "commits" && subId && HEX.test(subId)) {
        return { kind: "commit", repo: full, sha: subId.toLowerCase() };
      }
      return { kind: "pull", repo: full, number: Number(id) };
    }
    if ((type === "commit" || type === "commits") && HEX.test(id)) return { kind: "commit", repo: full, sha: id.toLowerCase() };
    if (type === "tree") {
      // A stray "%" such as /tree/100%-done is not valid percent-encoding, and must not fail the whole sync.
      try {
        return { kind: "tree", repo: full, rest: decodeURIComponent(parts.slice(3).join("/")) };
      } catch {
        return null;
      }
    }
    return null;
  }
  const item = PLANE_ITEM.exec(url.pathname);
  if (item) return { kind: "workitem", id: item[1].toLowerCase(), host };
  const browse = PLANE_BROWSE.exec(url.pathname);
  if (browse) return { kind: "key", key: browse[1].toUpperCase(), host };
  const slack = SLACK_PERMALINK.exec(url.pathname);
  if (slack) return { kind: "slack", channel: slack[1], ts: `${slack[2]}.${slack[3]}`, host };
  return null;
}

/**
 * Every explicit reference in a Source's title, text and branch name. Names and similar wording never count.
 * A deleted Source references nothing, so its edges are removed.
 */
export function findReferences(source: ScanSource): Found[] {
  const found = new Map<string, Found>();
  if (source.deleted) return [];
  const add = (ref: Reference, method: Method) => {
    const key = refKey(ref);
    if (!found.has(key)) found.set(key, { ref, method });
  };

  const text = withoutCode(`${source.title}\n${source.text}`);
  for (const raw of text.match(URL) ?? []) {
    const ref = parseUrl(raw);
    if (ref) add(ref, "url");
  }
  const prose = text.replace(URL, " ");
  for (const [, key] of prose.matchAll(KEY)) add({ kind: "key", key: key.toUpperCase() }, "key");

  const repo = githubRepo(source);
  if (repo) {
    for (const [sha] of prose.matchAll(SHA)) {
      // A digit and a letter, so hex-looking words such as "defaced" and plain numbers are not SHAs.
      if (/\d/.test(sha) && /[a-f]/i.test(sha)) add({ kind: "commit", repo, sha: sha.toLowerCase() }, "sha");
    }
  }
  if (source.branch) {
    for (const [, key] of source.branch.matchAll(KEY)) add({ kind: "key", key: key.toUpperCase() }, "branch");
  }
  return [...found.values()];
}

/** Bounds for an indexed range scan over ids that start with `prefix`. STARTS WITH does not use the index. */
function idRange(prefix: string) {
  return { lo: prefix, hi: prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1) };
}

type Hit = { key: string; id: string; url: string | null };

/**
 * Resolves references to Source ids already in this graph. Unresolved and ambiguous references are left out,
 * and a Plane or Slack URL only resolves to a Source stored under the same host.
 */
async function resolve(graph: AxonGraph, refs: Reference[]): Promise<Map<string, string>> {
  const hosts = new Map(refs.flatMap((r) => ("host" in r && r.host ? [[refKey(r), r.host] as const] : [])));
  const hits: Hit[] = [];
  const byKind = <K extends Reference["kind"]>(kind: K) =>
    refs.filter((r): r is Extract<Reference, { kind: K }> => r.kind === kind);

  const exact = [
    ...byKind("pull").map((r) => ({ key: refKey(r), id: sourceId("github", `${r.repo}/pull/${r.number}`) })),
    ...byKind("workitem").map((r) => ({ key: refKey(r), id: sourceId("plane", r.id) })),
    ...byKind("slack").map((r) => ({ key: refKey(r), id: sourceId("slack", `${r.channel}:${r.ts}`) })),
  ];
  if (exact.length > 0) {
    hits.push(
      ...(await graph.query<Hit>(
        `UNWIND $rows AS r
         MATCH (s:Source {id: r.id})
         RETURN r.key AS key, s.id AS id, s.url AS url`,
        { rows: exact },
      )),
    );
  }

  const keys = byKind("key");
  if (keys.length > 0) {
    const rows = await graph.query<{ key: string; id: string; url: string | null }>(
      "MATCH (s:WorkItem:Source) WHERE s.key IN $keys RETURN s.key AS key, s.id AS id, s.url AS url",
      { keys: [...new Set(keys.map((r) => r.key))] },
    );
    for (const ref of keys) {
      for (const row of rows) if (row.key === ref.key) hits.push({ ...row, key: refKey(ref) });
    }
  }

  const commits = byKind("commit").map((r) => ({ key: refKey(r), ...idRange(sourceId("github", `${r.repo}/commit/${r.sha}`)) }));
  if (commits.length > 0) {
    hits.push(
      ...(await graph.query<Hit>(
        `UNWIND $rows AS r
         MATCH (s:Commit:Source) WHERE s.id >= r.lo AND s.id < r.hi
         RETURN r.key AS key, s.id AS id, s.url AS url`,
        { rows: commits },
      )),
    );
  }

  const trees = byKind("tree").map((r) => ({ key: refKey(r), rest: r.rest, ...idRange(sourceId("github", `${r.repo}/pull/`)) }));
  if (trees.length > 0) {
    // Branch names can contain "/", so /tree/<branch>/<path> resolves to the longest branch that fits.
    const rows = await graph.query<Hit & { branch: string }>(
      `UNWIND $rows AS r
       MATCH (s:PR:Source) WHERE s.id >= r.lo AND s.id < r.hi AND s.branch IS NOT NULL
         AND (r.rest = s.branch OR r.rest STARTS WITH (s.branch + '/'))
       RETURN r.key AS key, s.id AS id, s.url AS url, s.branch AS branch`,
      { rows: trees },
    );
    const longest = new Map<string, number>();
    for (const row of rows) longest.set(row.key, Math.max(longest.get(row.key) ?? 0, row.branch.length));
    hits.push(...rows.filter((row) => row.branch.length === longest.get(row.key)));
  }

  // Exactly one match or none, as for a short SHA: two PRs on one branch or two commits sharing a prefix link to neither.
  const byKey = new Map<string, Set<string>>();
  for (const hit of hits) {
    const host = hosts.get(hit.key);
    if (host && hostOf(hit.url) !== host) continue;
    byKey.set(hit.key, (byKey.get(hit.key) ?? new Set()).add(hit.id));
  }
  const resolved = new Map<string, string>();
  for (const [key, ids] of byKey) if (ids.size === 1) resolved.set(key, [...ids][0]);
  return resolved;
}

async function storeLinkProperties(graph: AxonGraph, batch: Batch) {
  const sources = (batch.sources ?? []).map((s) => ({
    id: sourceId(s.connector, s.external_id),
    key: s.key ?? null,
    branch: s.branch ?? null,
  }));
  if (sources.length > 0) {
    // ref_text is stored lowercased once here, so the referrer scan does not recompute it for every Source.
    // It reads r.branch: a later SET in the same query still sees the old s.branch on FalkorDB.
    await graph.query(
      `UNWIND $rows AS r
       MATCH (s:Source {id: r.id})
       SET s.key = coalesce(r.key, s.key), s.branch = coalesce(r.branch, s.branch)
       SET s.ref_text = toLower(coalesce(s.title, '') + ' ' + coalesce(s.text, '') + ' ' + coalesce(r.branch, s.branch, ''))`,
      { rows: sources },
    );
  }
  const projects = (batch.projects ?? [])
    .filter((p) => p.key)
    .map((p) => ({ id: projectId(p.connector, p.external_id), key: p.key! }));
  if (projects.length > 0) {
    await graph.query("UNWIND $rows AS r MATCH (p:Project {id: r.id}) SET p.key = r.key", { rows: projects });
  }
}

/** Lowercase strings that a Source referring to one of these Sources would have to contain. */
function needlesFor(sources: ScanSource[], keys: Map<string, string>): string[] {
  const needles = new Set<string>();
  for (const s of sources) {
    const id = s.external_id.toLowerCase();
    if (s.connector === "plane") {
      needles.add(id);
      const key = keys.get(s.id);
      if (key) needles.add(key.toLowerCase());
    }
    if (s.connector === "slack") {
      const [, ts] = s.external_id.split(":");
      if (ts) needles.add(`p${ts.replace(".", "")}`);
    }
    if (s.connector === "github") {
      const pull = /^([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(id);
      if (pull) {
        needles.add(`${pull[1]}/pull/${pull[2]}`);
        needles.add(`${pull[1]}/issues/${pull[2]}`);
        if (s.branch) needles.add(`/tree/${s.branch.toLowerCase()}`);
      }
      const commit = /\/commit\/([0-9a-f]{7,40})$/.exec(id);
      if (commit) needles.add(commit[1].slice(0, 7));
    }
  }
  return [...needles];
}

async function readSources(graph: AxonGraph, ids: string[]) {
  return graph.query<ScanSource & { key: string | null }>(
    `MATCH (s:Source) WHERE s.id IN $ids
     RETURN s.id AS id, s.connector AS connector, s.external_id AS external_id,
            coalesce(s.title, '') AS title, coalesce(s.text, '') AS text, s.branch AS branch, s.key AS key,
            s.deleted_at IS NOT NULL AS deleted`,
    { ids },
  );
}

/** Sources outside `ids` whose text may refer to one of `ids`. They are re-scanned so sync order does not matter. */
async function referringSources(graph: AxonGraph, ids: string[], needles: string[]): Promise<string[]> {
  if (needles.length === 0) return [];
  const rows = await graph.query<{ id: string }>(
    // any(n IN $needles WHERE alias CONTAINS n) over a WITH alias matched nothing on FalkorDB 4.18; on a property it works.
    `MATCH (s:Source)
     WHERE s.ref_text IS NOT NULL AND any(n IN $needles WHERE s.ref_text CONTAINS n) AND NOT s.id IN $ids
     RETURN s.id AS id LIMIT ${CANDIDATE_LIMIT}`,
    { ids, needles },
  );
  return rows.map((r) => r.id);
}

/**
 * Rewrites (Source)-[:REFERENCES {methods}]->(Source) for every Source in the batch, and for Sources that mention them.
 * One edge per pair; edges whose reference is gone from the text are deleted.
 */
export async function writeReferences(graph: AxonGraph, batch: Batch): Promise<void> {
  await storeLinkProperties(graph, batch);
  const ids = [...new Set((batch.sources ?? []).map((s) => sourceId(s.connector, s.external_id)))];
  if (ids.length === 0) return;

  const written = await readSources(graph, ids);
  const keys = new Map(written.flatMap((s) => (s.key ? [[s.id, s.key] as const] : [])));
  const others = await referringSources(graph, ids, needlesFor(written, keys));
  const scanned = [...written, ...(others.length > 0 ? await readSources(graph, others) : [])];

  const found = new Map(scanned.map((s) => [s.id, findReferences(s)]));
  const refs = [...new Map([...found.values()].flat().map((f) => [refKey(f.ref), f.ref])).values()];
  const resolved = await resolve(graph, refs);

  const edges: { from: string; to: string; methods: string[] }[] = [];
  const keep: { id: string; targets: string[] }[] = [];
  for (const [from, refsFound] of found) {
    const methods = new Map<string, Set<Method>>();
    for (const f of refsFound) {
      const to = resolved.get(refKey(f.ref));
      if (!to || to === from) continue;
      const set = methods.get(to) ?? new Set<Method>();
      set.add(f.method);
      methods.set(to, set);
    }
    for (const [to, set] of methods) edges.push({ from, to, methods: [...set].sort() });
    keep.push({ id: from, targets: [...methods.keys()] });
  }

  await graph.query(
    `UNWIND $rows AS r
     MATCH (a:Source {id: r.id})-[e:REFERENCES]->(b)
     WHERE NOT b.id IN r.targets
     DELETE e`,
    { rows: keep },
  );
  if (edges.length === 0) return;
  await graph.query(
    `UNWIND $rows AS r
     MATCH (a:Source {id: r.from})
     MATCH (b:Source {id: r.to})
     MERGE (a)-[e:REFERENCES]->(b)
     SET e.methods = r.methods`,
    { rows: edges },
  );
}
