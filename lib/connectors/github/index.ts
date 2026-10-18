import { createHmac, timingSafeEqual } from "node:crypto";

import type { AxonGraph } from "@/lib/graph/client";
import type { Batch, Connector, ConnectorContext } from "@/lib/connectors/types";
import { codeUnitId } from "@/lib/connectors/write";

import { ghAll, ghGet, ghPages } from "./api";
import { CODEOWNERS_PATHS, ownersOf, parseCodeowners } from "./codeowners";
import {
  CONNECTOR,
  commentBatch,
  commitBatch,
  docBatch,
  isDocPath,
  mergeBatches,
  ownershipBatch,
  pullBatch,
  reviewBatch,
  type GhComment,
  type GhCommit,
  type GhPull,
  type GhRepo,
  type GhReview,
  type GhUser,
} from "./normalize";

type TreeEntry = { path: string; type: string; sha: string };
type Blob = { content: string };

export type GhEvent = {
  action?: string;
  installation?: { id: number };
  repository?: GhRepo;
  pull_request?: GhPull;
  review?: GhReview;
  comment?: GhComment;
  issue?: GhPull & { pull_request?: { html_url: string } };
  ref?: string;
  after?: string;
  commits?: { id: string; added: string[]; modified: string[]; removed: string[] }[];
  repositories_added?: { full_name: string }[];
  repositories_removed?: { full_name: string }[];
};

function repoPath(repo: GhRepo): string {
  return `/repos/${repo.full_name}`;
}

async function pullRequestBatch(token: string, repo: GhRepo, pr: GhPull): Promise<Batch> {
  const base = `${repoPath(repo)}/pulls/${pr.number}`;
  const [files, reviews, reviewComments, comments] = await Promise.all([
    ghAll<{ filename: string }>(token, `${base}/files`),
    ghAll<GhReview>(token, `${base}/reviews`),
    ghAll<GhComment>(token, `${base}/comments`),
    ghAll<GhComment>(token, `${repoPath(repo)}/issues/${pr.number}/comments`),
  ]);
  return mergeBatches([
    pullBatch(repo, pr, files.map((f) => f.filename)),
    ...reviews.map((r) => reviewBatch(repo, pr.number, r)),
    ...reviewComments.map((c) => commentBatch(repo, pr.number, c, "review-comment")),
    ...comments.map((c) => commentBatch(repo, pr.number, c, "comment")),
  ]);
}

async function docBatchAt(token: string, repo: GhRepo, entry: TreeEntry): Promise<Batch> {
  const [blob, [last]] = await Promise.all([
    ghGet<Blob>(token, `${repoPath(repo)}/git/blobs/${entry.sha}`),
    ghGet<GhCommit[]>(
      token,
      `${repoPath(repo)}/commits?sha=${repo.default_branch}&path=${encodeURIComponent(entry.path)}&per_page=1`,
    ),
  ]);
  const text = Buffer.from(blob.content, "base64").toString("utf8");
  return docBatch(repo, entry.path, text, last?.commit.author?.date ?? new Date().toISOString());
}

async function clearCodeowners(graph: AxonGraph, repo: GhRepo): Promise<void> {
  await graph.query(
    `MATCH (:Person)-[o:OWNS {via: 'CODEOWNERS'}]->(:CodeUnit)-[:PART_OF]->(:CodeUnit {id: $repoId})
     DELETE o`,
    { repoId: codeUnitId(repo.full_name, "/") },
  );
}

async function codeownersBatch(token: string, repo: GhRepo, tree: TreeEntry[], graph: AxonGraph): Promise<Batch> {
  const file = CODEOWNERS_PATHS.map((path) => tree.find((e) => e.path === path)).find(Boolean);
  await clearCodeowners(graph, repo);
  if (!file) return {};
  const blob = await ghGet<Blob>(token, `${repoPath(repo)}/git/blobs/${file.sha}`);
  const rules = parseCodeowners(Buffer.from(blob.content, "base64").toString("utf8"));
  const owned = tree
    .filter((e) => e.type === "blob")
    .flatMap((e) => ownersOf(rules, e.path).map((login) => ({ login, path: e.path })));
  const logins = [...new Set(owned.map((o) => o.login))];
  const users = new Map<string, GhUser>();
  for (const login of logins) {
    try {
      users.set(login, await ghGet<GhUser>(token, `/users/${encodeURIComponent(login)}`));
    } catch {
      console.warn(`CODEOWNERS: no GitHub user ${login}`);
    }
  }
  return ownershipBatch(
    repo,
    owned.flatMap(({ login, path }) => {
      const owner = users.get(login);
      return owner ? [{ owner, path }] : [];
    }),
  );
}

async function treeOf(token: string, repo: GhRepo, ref: string): Promise<TreeEntry[]> {
  const res = await ghGet<{ tree: TreeEntry[] }>(token, `${repoPath(repo)}/git/trees/${ref}?recursive=1`);
  return res.tree;
}

async function* backfillRepo(ctx: ConnectorContext, token: string, repo: GhRepo): AsyncIterable<Batch> {
  for await (const pr of ghPages<GhPull>(token, `${repoPath(repo)}/pulls?state=all`)) {
    if (ctx.since && pr.updated_at < ctx.since) continue;
    yield await pullRequestBatch(token, repo, pr);
  }
  const since = ctx.since ? `&since=${ctx.since}` : "";
  for await (const commit of ghPages<GhCommit>(token, `${repoPath(repo)}/commits?sha=${repo.default_branch}${since}`)) {
    yield commitBatch(repo, await ghGet<GhCommit>(token, `${repoPath(repo)}/commits/${commit.sha}`));
  }
  const tree = await treeOf(token, repo, repo.default_branch);
  for (const entry of tree.filter((e) => e.type === "blob" && isDocPath(e.path))) {
    yield await docBatchAt(token, repo, entry);
  }
  yield await codeownersBatch(token, repo, tree, ctx.graph);
}

/** Backfills the installation's repositories, or only those in `only` (full names). */
export async function* backfillInstallation(ctx: ConnectorContext, only?: string[]): AsyncIterable<Batch> {
  const token = ctx.token!;
  for (const repo of await ghAll<GhRepo>(token, "/installation/repositories")) {
    if (only && !only.includes(repo.full_name)) continue;
    yield* backfillRepo(ctx, token, repo);
  }
}

function backfill(ctx: ConnectorContext): AsyncIterable<Batch> {
  return backfillInstallation(ctx);
}

async function* pushBatches(ctx: ConnectorContext, token: string, repo: GhRepo, event: GhEvent): AsyncIterable<Batch> {
  if (event.ref !== `refs/heads/${repo.default_branch}` || !event.after) return;
  const commits = event.commits ?? [];
  for (const { id } of commits) {
    yield commitBatch(repo, await ghGet<GhCommit>(token, `${repoPath(repo)}/commits/${id}`));
  }
  const changed = new Set(commits.flatMap((c) => [...c.added, ...c.modified]));
  const removed = new Set(commits.flatMap((c) => c.removed).filter((p) => !changed.has(p)));
  const now = new Date().toISOString();
  for (const path of removed) {
    if (isDocPath(path)) yield docBatch(repo, path, "", now, now);
  }
  const touched = [...changed, ...removed];
  if (!touched.some((p) => isDocPath(p) || CODEOWNERS_PATHS.includes(p))) return;
  const tree = await treeOf(token, repo, event.after);
  for (const entry of tree.filter((e) => changed.has(e.path) && isDocPath(e.path))) {
    yield await docBatchAt(token, repo, entry);
  }
  if (touched.some((p) => CODEOWNERS_PATHS.includes(p))) {
    yield await codeownersBatch(token, repo, tree, ctx.graph);
  }
}

const FILE_ACTIONS = ["opened", "reopened", "synchronize"];

/** Only pushes and new PR commits need API reads. Every other event carries what it changed. */
export function eventNeedsToken(name: string | null, event: GhEvent): boolean {
  return name === "push" || (name === "pull_request" && FILE_ACTIONS.includes(event.action ?? ""));
}

async function* eventToBatches(headers: Headers, event: GhEvent, ctx: ConnectorContext): AsyncIterable<Batch> {
  const repo = event.repository;
  if (!repo) return;
  const deletedAt = event.action === "deleted" ? new Date().toISOString() : undefined;
  switch (headers.get("x-github-event")) {
    case "pull_request": {
      const pr = event.pull_request!;
      if (FILE_ACTIONS.includes(event.action ?? "")) {
        const files = await ghAll<{ filename: string }>(ctx.token!, `${repoPath(repo)}/pulls/${pr.number}/files`);
        yield pullBatch(repo, pr, files.map((f) => f.filename));
      } else {
        yield pullBatch(repo, pr);
      }
      return;
    }
    case "pull_request_review": {
      if (event.action === "dismissed") return;
      const pr = event.pull_request!;
      yield mergeBatches([pullBatch(repo, pr), reviewBatch(repo, pr.number, event.review!)]);
      return;
    }
    case "pull_request_review_comment": {
      const pr = event.pull_request!;
      yield mergeBatches([
        pullBatch(repo, pr),
        commentBatch(repo, pr.number, event.comment!, "review-comment", deletedAt),
      ]);
      return;
    }
    case "issue_comment": {
      const issue = event.issue!;
      if (!issue.pull_request) return;
      const pr: GhPull = { ...issue, html_url: issue.pull_request.html_url };
      yield mergeBatches([pullBatch(repo, pr), commentBatch(repo, pr.number, event.comment!, "comment", deletedAt)]);
      return;
    }
    case "push":
      yield* pushBatches(ctx, ctx.token!, repo, event);
      return;
  }
}

function verifyWebhook(req: Request, rawBody: string): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const signature = req.headers.get("x-hub-signature-256");
  if (!secret || !signature) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const github: Connector<GhEvent> = { name: CONNECTOR, backfill, verifyWebhook, eventToBatches };
