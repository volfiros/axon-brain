import type { Batch, LinkInput, NodeRef, PersonRef, Sensitivity, SourceInput } from "@/lib/connectors/types";

export const CONNECTOR = "github";

export type GhUser = { id: number; login: string; type: string };
export type GhRepo = { full_name: string; private: boolean; default_branch: string; html_url: string };
export type GhPull = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: GhUser | null;
  created_at: string;
  updated_at: string;
};
export type GhReview = {
  id: number;
  body: string | null;
  html_url: string;
  user: GhUser | null;
  submitted_at: string | null;
};
export type GhComment = {
  id: number;
  body: string | null;
  html_url: string;
  user: GhUser | null;
  created_at: string;
  updated_at: string;
  path?: string;
};
export type GhCommit = {
  sha: string;
  html_url: string;
  author: GhUser | null;
  commit: { message: string; author: { name: string; date: string } | null };
  files?: { filename: string }[];
};
export type CommentKind = "review-comment" | "comment";

export function isDocPath(path: string): boolean {
  if (!path.endsWith(".md") || path.startsWith("docs/archive/")) return false;
  return path === "README.md" || path.startsWith("docs/") || /(^|\/)adrs?\//i.test(path);
}

function sensitivity(repo: GhRepo): Sensitivity {
  return repo.private ? "team" : "public";
}

function isBot(user: GhUser): boolean {
  return user.type === "Bot" || user.login.endsWith("[bot]");
}

export function personOf(user: GhUser | null): PersonRef | null {
  if (!user || isBot(user)) return null;
  return { connector: CONNECTOR, external_id: String(user.id), handle: user.login, name: user.login };
}

function sourceRef(externalId: string): NodeRef {
  return { kind: "source", connector: CONNECTOR, external_id: externalId };
}

function fileRef(repo: GhRepo, path: string): NodeRef {
  return { kind: "codeunit", repo: repo.full_name, path };
}

function withAuthor(source: SourceInput, author: PersonRef | null, links: LinkInput[] = []): Batch {
  const authored: LinkInput[] = author
    ? [{ from: { kind: "person", ...author }, rel: "AUTHORED", to: sourceRef(source.external_id) }]
    : [];
  return { sources: [source], people: author ? [author] : [], links: [...authored, ...links] };
}

export function pullId(repo: GhRepo, number: number): string {
  return `${repo.full_name}/pull/${number}`;
}

export function pullBatch(repo: GhRepo, pr: GhPull, files: string[] = []): Batch {
  if (pr.user && isBot(pr.user)) return {};
  const id = pullId(repo, pr.number);
  return withAuthor(
    {
      connector: CONNECTOR,
      external_id: id,
      labels: ["PR"],
      title: `PR #${pr.number}: ${pr.title}`,
      text: pr.body ?? "",
      url: pr.html_url,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      sensitivity: sensitivity(repo),
    },
    personOf(pr.user),
    files.map((path) => ({ from: sourceRef(id), rel: "TOUCHES", to: fileRef(repo, path) })),
  );
}

export function reviewBatch(repo: GhRepo, prNumber: number, review: GhReview, deletedAt?: string): Batch {
  if (!review.user || isBot(review.user) || !review.body?.trim()) return {};
  const id = `${repo.full_name}/review/${review.id}`;
  const at = review.submitted_at ?? new Date().toISOString();
  return withAuthor(
    {
      connector: CONNECTOR,
      external_id: id,
      labels: ["Message"],
      title: `Review on PR #${prNumber}`,
      text: review.body,
      url: review.html_url,
      created_at: at,
      deleted_at: deletedAt,
      sensitivity: sensitivity(repo),
    },
    personOf(review.user),
    [{ from: sourceRef(id), rel: "PART_OF", to: sourceRef(pullId(repo, prNumber)) }],
  );
}

export function commentBatch(
  repo: GhRepo,
  prNumber: number,
  comment: GhComment,
  kind: CommentKind,
  deletedAt?: string,
): Batch {
  if (!comment.user || isBot(comment.user)) return {};
  const id = `${repo.full_name}/${kind}/${comment.id}`;
  const links: LinkInput[] = [{ from: sourceRef(id), rel: "PART_OF", to: sourceRef(pullId(repo, prNumber)) }];
  if (comment.path) links.push({ from: sourceRef(id), rel: "TOUCHES", to: fileRef(repo, comment.path) });
  return withAuthor(
    {
      connector: CONNECTOR,
      external_id: id,
      labels: ["Message"],
      title: comment.path ? `Review comment on PR #${prNumber}: ${comment.path}` : `Comment on PR #${prNumber}`,
      text: comment.body ?? "",
      url: comment.html_url,
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      deleted_at: deletedAt,
      sensitivity: sensitivity(repo),
    },
    personOf(comment.user),
    links,
  );
}

export function commitBatch(repo: GhRepo, commit: GhCommit): Batch {
  const id = `${repo.full_name}/commit/${commit.sha}`;
  const message = commit.commit.message;
  return withAuthor(
    {
      connector: CONNECTOR,
      external_id: id,
      labels: ["Commit"],
      title: message.split("\n")[0],
      text: message,
      url: commit.html_url,
      created_at: commit.commit.author?.date ?? new Date().toISOString(),
      sensitivity: sensitivity(repo),
      extract: false,
    },
    personOf(commit.author),
    (commit.files ?? []).map((f) => ({ from: sourceRef(id), rel: "TOUCHES", to: fileRef(repo, f.filename) })),
  );
}

export function docBatch(
  repo: GhRepo,
  path: string,
  text: string,
  updatedAt: string,
  deletedAt?: string,
): Batch {
  return {
    sources: [
      {
        connector: CONNECTOR,
        external_id: `${repo.full_name}/doc/${path}`,
        labels: ["Doc"],
        title: path,
        text,
        url: `${repo.html_url}/blob/${repo.default_branch}/${path}`,
        created_at: updatedAt,
        updated_at: updatedAt,
        deleted_at: deletedAt,
        sensitivity: sensitivity(repo),
      },
    ],
  };
}

export function ownershipBatch(repo: GhRepo, owned: { owner: GhUser; path: string }[]): Batch {
  const people = owned.map(({ owner }) => personOf(owner)).filter((p): p is PersonRef => p !== null);
  return {
    people,
    links: owned.flatMap(({ owner, path }) => {
      const person = personOf(owner);
      return person
        ? [{ from: { kind: "person", ...person }, rel: "OWNS", to: fileRef(repo, path), props: { via: "CODEOWNERS" } }]
        : [];
    }),
  };
}

export function mergeBatches(batches: Batch[]): Batch {
  return {
    sources: batches.flatMap((b) => b.sources ?? []),
    people: batches.flatMap((b) => b.people ?? []),
    projects: batches.flatMap((b) => b.projects ?? []),
    codeUnits: batches.flatMap((b) => b.codeUnits ?? []),
    links: batches.flatMap((b) => b.links ?? []),
  };
}
