import { createHmac } from "node:crypto";

import type { GhComment, GhPull, GhRepo, GhReview, GhUser } from "@/lib/connectors/github/normalize";
import type { PlaneProject, PlaneWorkItem } from "@/lib/connectors/plane/normalize";
import type { SlackMessage } from "@/lib/connectors/slack/normalize";

export function hmacHex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function ghUser(overrides: Partial<GhUser> = {}): GhUser {
  return { id: 101, login: "ada", type: "User", ...overrides };
}

export function ghRepo(overrides: Partial<GhRepo> = {}): GhRepo {
  return {
    full_name: "acme/app",
    private: false,
    default_branch: "main",
    html_url: "https://github.com/acme/app",
    ...overrides,
  };
}

export function ghPull(overrides: Partial<GhPull> = {}): GhPull {
  return {
    number: 7,
    title: "Fix refunds",
    body: "Refunds now round down.",
    html_url: "https://github.com/acme/app/pull/7",
    user: ghUser(),
    head: { ref: "feat/bil-12-refunds" },
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-02T10:00:00Z",
    ...overrides,
  };
}

export function ghReview(overrides: Partial<GhReview> = {}): GhReview {
  return {
    id: 501,
    body: "Looks good, ship it.",
    html_url: "https://github.com/acme/app/pull/7#pullrequestreview-501",
    user: ghUser({ id: 102, login: "grace" }),
    submitted_at: "2026-10-02T12:00:00Z",
    ...overrides,
  };
}

export function ghComment(overrides: Partial<GhComment> = {}): GhComment {
  return {
    id: 901,
    body: "Why round down?",
    html_url: "https://github.com/acme/app/pull/7#issuecomment-901",
    user: ghUser({ id: 102, login: "grace" }),
    created_at: "2026-10-02T11:00:00Z",
    updated_at: "2026-10-02T11:30:00Z",
    ...overrides,
  };
}

export function slackMessage(overrides: Partial<SlackMessage> = {}): SlackMessage {
  return { ts: "1760000000.000100", user: "U1", text: "We decided to drop the v1 API", ...overrides };
}

export function planeProject(overrides: Partial<PlaneProject> = {}): PlaneProject {
  return { id: "proj-1", name: "Billing", identifier: "BIL", network: 2, project_lead: "lead-1", ...overrides };
}

export function planeWorkItem(overrides: Partial<PlaneWorkItem> = {}): PlaneWorkItem {
  return {
    id: "item-1",
    name: "Refund rounding",
    description_stripped: "Round refunds down to the cent.",
    project: "proj-1",
    assignees: ["member-2"],
    created_by: "member-1",
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-03T10:00:00Z",
    sequence_id: 12,
    ...overrides,
  };
}
