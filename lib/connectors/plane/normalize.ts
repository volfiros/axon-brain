import type { Batch, PersonRef, Sensitivity } from "../types";

export type PlaneMember = {
  id: string;
  member?: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
};

export type PlaneProject = {
  id: string;
  name: string;
  identifier?: string;
  network?: number;
  project_lead?: string | null;
  archived_at?: string | null;
};

export type PlaneWorkItem = {
  id: string;
  name: string;
  description_html?: string;
  description_stripped?: string | null;
  project: string;
  assignees?: (string | { id: string })[];
  created_by?: string | null;
  created_at: string;
  updated_at?: string;
  sequence_id?: number;
};

export type PlaneComment = {
  id: string;
  comment_html?: string;
  comment_stripped?: string | null;
  issue: string;
  actor?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string;
};

export type PlanePage = {
  id: string;
  name: string;
  description_html?: string;
  description_stripped?: string | null;
  description?: unknown;
  owned_by?: string | null;
  access?: number;
  archived_at?: string | null;
  created_at: string;
  updated_at?: string;
};

export type ProjectScope = { id: string; sensitivity: Sensitivity; visible_to?: PersonRef[]; key?: string };

export type PlaneLinks = { appUrl: string; workspaceSlug: string };

type PlaneBatch = Required<Batch>;

const PUBLIC_NETWORK = 2;
const PUBLIC_PAGE = 0;

function newBatch(): PlaneBatch {
  return { sources: [], people: [], projects: [], codeUnits: [], links: [] };
}

export function planeRef(id: string): PersonRef {
  return { connector: "plane", external_id: id };
}

function node(kind: "source" | "person" | "project", id: string) {
  return { kind, connector: "plane", external_id: id };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function memberToPerson(member: PlaneMember): PersonRef {
  const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ").trim();
  return {
    connector: "plane",
    external_id: member.member ?? member.id,
    name: fullName || member.display_name || undefined,
    handle: member.display_name || undefined,
    email: member.email?.toLowerCase() || undefined,
  };
}

// Anything not explicitly public is treated as secret, so a payload missing `network` cannot widen access.
export function isSecret(project: PlaneProject): boolean {
  return project.network !== PUBLIC_NETWORK;
}

export function scopeOf(project: PlaneProject, visibleTo?: PersonRef[]): ProjectScope {
  return isSecret(project)
    ? { id: project.id, sensitivity: "restricted", visible_to: visibleTo ?? [], key: project.identifier }
    : { id: project.id, sensitivity: "team", key: project.identifier };
}

function workItemUrl(links: PlaneLinks, projectId: string, itemId: string): string {
  return `${links.appUrl}/${links.workspaceSlug}/projects/${projectId}/issues/${itemId}`;
}

export function projectBatch(project: PlaneProject, links: PlaneLinks): PlaneBatch {
  const batch = newBatch();
  batch.projects.push({
    connector: "plane",
    external_id: project.id,
    name: project.name,
    url: `${links.appUrl}/${links.workspaceSlug}/projects/${project.id}/issues/`,
    sensitivity: isSecret(project) ? "restricted" : "team",
    key: project.identifier,
  });
  if (project.project_lead) {
    batch.people.push(planeRef(project.project_lead));
    batch.links.push({ from: node("person", project.project_lead), rel: "OWNS", to: node("project", project.id) });
  }
  return batch;
}

function assigneeId(assignee: string | { id: string }): string {
  return typeof assignee === "string" ? assignee : assignee.id;
}

export function workItemBatch(scope: ProjectScope, item: PlaneWorkItem, links: PlaneLinks, deletedAt?: string): PlaneBatch {
  const batch = newBatch();
  const description = item.description_stripped ?? htmlToText(item.description_html ?? "");
  batch.sources.push({
    connector: "plane",
    external_id: item.id,
    labels: ["WorkItem"],
    url: workItemUrl(links, scope.id, item.id),
    title: item.name,
    text: description ? `${item.name}\n\n${description}` : item.name,
    created_at: item.created_at,
    updated_at: item.updated_at,
    deleted_at: deletedAt,
    sensitivity: scope.sensitivity,
    visible_to: scope.visible_to,
    key: scope.key && item.sequence_id ? `${scope.key}-${item.sequence_id}` : undefined,
  });
  batch.links.push({ from: node("source", item.id), rel: "PART_OF", to: node("project", scope.id) });
  if (item.created_by) {
    batch.people.push(planeRef(item.created_by));
    batch.links.push({ from: node("person", item.created_by), rel: "AUTHORED", to: node("source", item.id) });
  }
  for (const assignee of (item.assignees ?? []).map(assigneeId)) {
    batch.people.push(planeRef(assignee));
    batch.links.push({ from: node("person", assignee), rel: "OWNS", to: node("source", item.id) });
  }
  return batch;
}

export function commentBatch(
  scope: ProjectScope,
  comment: PlaneComment,
  itemName: string,
  links: PlaneLinks,
  deletedAt?: string,
): PlaneBatch {
  const batch = newBatch();
  const author = comment.actor ?? comment.created_by;
  batch.sources.push({
    connector: "plane",
    external_id: comment.id,
    labels: ["Message"],
    url: `${workItemUrl(links, scope.id, comment.issue)}#comment-${comment.id}`,
    title: `Comment on ${itemName}`,
    text: comment.comment_stripped ?? htmlToText(comment.comment_html ?? ""),
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    deleted_at: deletedAt,
    sensitivity: scope.sensitivity,
    visible_to: scope.visible_to,
  });
  batch.links.push({ from: node("source", comment.id), rel: "PART_OF", to: node("source", comment.issue) });
  if (author) {
    batch.people.push(planeRef(author));
    batch.links.push({ from: node("person", author), rel: "AUTHORED", to: node("source", comment.id) });
  }
  return batch;
}

export function pageUrl(links: PlaneLinks, projectId: string, pageId: string): string {
  return `${links.appUrl}/${links.workspaceSlug}/projects/${projectId}/pages/${pageId}`;
}

// A private page stays with its owner even inside a public project; a missing `access` counts as private.
export function pageBatch(scope: ProjectScope, page: PlanePage, links: PlaneLinks, deletedAt?: string): PlaneBatch {
  const batch = newBatch();
  const shared = page.access === PUBLIC_PAGE;
  const owner = page.owned_by ? [planeRef(page.owned_by)] : [];
  // Plane's page detail documents `description`; older responses carry `description_html` instead.
  const html = page.description_html ?? (typeof page.description === "string" ? page.description : "");
  const body = page.description_stripped ?? htmlToText(html);
  batch.sources.push({
    connector: "plane",
    external_id: page.id,
    labels: ["Doc"],
    url: pageUrl(links, scope.id, page.id),
    title: page.name,
    text: body ? `${page.name}\n\n${body}` : page.name,
    created_at: page.created_at,
    updated_at: page.updated_at,
    deleted_at: deletedAt,
    sensitivity: shared ? scope.sensitivity : "restricted",
    visible_to: shared ? scope.visible_to : owner,
  });
  batch.links.push({ from: node("source", page.id), rel: "PART_OF", to: node("project", scope.id) });
  if (page.owned_by) {
    batch.people.push(planeRef(page.owned_by));
    batch.links.push({ from: node("person", page.owned_by), rel: "AUTHORED", to: node("source", page.id) });
  }
  return batch;
}
