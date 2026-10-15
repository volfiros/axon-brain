"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAccount } from "@/lib/auth/session";
import { createInvite, leaveWorkspace, removeMember, revokeInvite, setRole, type Role } from "@/lib/workspaces";

type Result = { error?: string };

async function run(slug: string, change: (accountId: string) => Promise<void>): Promise<Result> {
  const account = await requireAccount(`/w/${slug}/members`);
  try {
    await change(account.id);
  } catch (err) {
    return { error: (err as Error).message };
  }
  revalidatePath(`/w/${slug}/members`);
  return {};
}

export async function changeRoleAction(slug: string, personId: string, role: Role): Promise<Result> {
  return run(slug, (accountId) => setRole(slug, accountId, personId, role));
}

export async function newInviteAction(slug: string): Promise<Result> {
  return run(slug, async (accountId) => {
    await createInvite(slug, accountId);
  });
}

export async function revokeInviteAction(slug: string): Promise<Result> {
  return run(slug, (accountId) => revokeInvite(slug, accountId));
}

export async function removeMemberAction(slug: string, personId: string): Promise<Result> {
  return run(slug, (accountId) => removeMember(slug, accountId, personId));
}

export async function leaveWorkspaceAction(slug: string): Promise<Result> {
  const result = await run(slug, (accountId) => leaveWorkspace(slug, accountId));
  if (result.error) return result;
  revalidatePath("/onboarding");
  redirect("/onboarding");
}
