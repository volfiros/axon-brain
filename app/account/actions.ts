"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { requireAccount } from "@/lib/auth/session";
import { renamePerson } from "@/lib/workspaces";

export type FormState = { error?: string; saved?: boolean };

export async function changeNameAction(_state: FormState, form: FormData): Promise<FormState> {
  const account = await requireAccount("/account");
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 80) return { error: "Use a name between 1 and 80 characters." };
  try {
    await auth.api.updateUser({ body: { name }, headers: await headers() });
    await renamePerson(account.id, name);
  } catch (err) {
    return { error: (err as Error).message };
  }
  revalidatePath("/", "layout");
  return { saved: true };
}
