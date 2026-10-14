"use server";

import { revalidatePath } from "next/cache";

import { requireAccount } from "@/lib/auth/session";
import { createInvite, setRole, type Role } from "@/lib/workspaces";

export async function changeRoleAction(slug: string, personId: string, role: Role): Promise<{ error?: string }> {
  const account = await requireAccount(`/w/${slug}/members`);
  try {
    await setRole(slug, account.id, personId, role);
  } catch (err) {
    return { error: (err as Error).message };
  }
  revalidatePath(`/w/${slug}/members`);
  return {};
}

export async function newInviteAction(slug: string): Promise<{ error?: string }> {
  const account = await requireAccount(`/w/${slug}/members`);
  try {
    await createInvite(slug, account.id);
  } catch (err) {
    return { error: (err as Error).message };
  }
  revalidatePath(`/w/${slug}/members`);
  return {};
}
