"use server";

import { revalidatePath } from "next/cache";

import { requireMember } from "@/lib/auth/session";
import { memberContext } from "@/lib/brain/overview";
import { confirmStillHolds } from "@/lib/brain/source-changes";

export async function stillHoldsAction(slug: string, decisionId: string): Promise<{ error?: string }> {
  const { member } = await requireMember(slug, `/w/${slug}`);
  if (member.role === "Guest") return { error: "Guests can read decisions but not confirm them." };
  const confirmed = await confirmStillHolds(memberContext(slug, member), [decisionId]);
  if (confirmed.length === 0) return { error: "This decision has no changed source you can see." };
  revalidatePath(`/w/${slug}`);
  return {};
}
