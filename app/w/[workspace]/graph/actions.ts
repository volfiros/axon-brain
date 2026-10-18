"use server";

import { requireMember } from "@/lib/auth/session";
import { decisionTrail, type DecisionTrail } from "@/lib/brain/graph-view";
import { memberContext } from "@/lib/brain/overview";

export async function decisionTrailAction(slug: string, decisionId: string): Promise<DecisionTrail | null> {
  const { member } = await requireMember(slug, `/w/${slug}/graph`);
  return decisionTrail(memberContext(slug, member), decisionId);
}
