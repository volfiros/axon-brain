import { FROM_CALLER, readAsCaller, visible } from "../access";
import type { BrainContext } from "../tool";
import type { Sensitivity } from "../write";

export type Match =
  | { kind: "new" }
  | { kind: "repeat"; decision_id: string }
  | { kind: "change"; decision_id: string };

export type Resolution =
  | { action: "create" }
  | { action: "link"; decisionId: string; title: string; status: string; caughtByTitle: boolean }
  | { action: "supersede"; decisionId: string; title: string; sensitivity: Sensitivity }
  | { action: "error"; reason: string };

type DecisionRow = { id: string; title: string; status: string; sensitivity: Sensitivity };

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function visibleDecision(ctx: BrainContext, decisionId: string): Promise<DecisionRow | undefined> {
  const [row] = await readAsCaller<DecisionRow>(
    ctx,
    `${FROM_CALLER}
     MATCH (d:Decision {id: $decisionId}) WHERE ${visible("d")}
     RETURN d.id AS id, d.title AS title, d.status AS status, coalesce(d.sensitivity, 'team') AS sensitivity`,
    { decisionId },
  );
  return row;
}

async function sameTitleDecision(ctx: BrainContext, title: string): Promise<DecisionRow | undefined> {
  const normalized = normalizeTitle(title);
  const words = normalized.split(" ").filter((word) => word.length > 1);
  if (words.length === 0) return undefined;
  const rows = await readAsCaller<DecisionRow>(
    ctx,
    `${FROM_CALLER}
     CALL db.idx.fulltext.queryNodes('Decision', $query) YIELD node AS d
     WITH u, role, d
     WHERE d.status IN ['accepted', 'proposed'] AND ${visible("d")}
     RETURN d.id AS id, d.title AS title, d.status AS status, coalesce(d.sensitivity, 'team') AS sensitivity
     LIMIT 25`,
    { query: words.join(" ") },
  );
  return rows.find((row) => normalizeTitle(row.title) === normalized);
}

/**
 * Checks the agent's new / repeat / change call for one distilled Decision against what the
 * caller can see. A referenced Decision must exist and be visible. A "new" Decision whose
 * normalized title equals a current visible Decision is turned into a link to that Decision.
 * A link to a proposed Decision means the person confirmed it, so saving accepts it.
 */
export async function resolveDecisionMatch(ctx: BrainContext, title: string, match: Match): Promise<Resolution> {
  if (match.kind === "new") {
    const existing = await sameTitleDecision(ctx, title);
    return existing
      ? { action: "link", decisionId: existing.id, title: existing.title, status: existing.status, caughtByTitle: true }
      : { action: "create" };
  }

  // Same answer for missing and hidden, so a Guest cannot probe for restricted Decision ids.
  const target = await visibleDecision(ctx, match.decision_id);
  if (!target) {
    return { action: "error", reason: `No Decision ${match.decision_id} that you can see` };
  }
  if (target.status === "dismissed") {
    return { action: "error", reason: `Decision ${target.id} was dismissed. Save this as new instead.` };
  }
  if (match.kind === "repeat") {
    return { action: "link", decisionId: target.id, title: target.title, status: target.status, caughtByTitle: false };
  }
  if (target.status === "superseded") {
    return {
      action: "error",
      reason: `Decision ${target.id} is already superseded. Supersede the current one instead.`,
    };
  }
  return { action: "supersede", decisionId: target.id, title: target.title, sensitivity: target.sensitivity };
}
