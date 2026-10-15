"use server";

import { redirect } from "next/navigation";

import { requireAccount } from "@/lib/auth/session";
import { createWorkspace, joinWithCode } from "@/lib/workspaces";

export type FormState = { error?: string };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function createWorkspaceAction(_state: FormState, form: FormData): Promise<FormState> {
  const account = await requireAccount("/onboarding");
  const name = String(form.get("name") ?? "").trim();
  const slug = String(form.get("slug") ?? "").trim().toLowerCase();
  if (!name) return { error: "Give the workspace a name." };
  if (!SLUG.test(slug) || slug === "accounts" || slug.length > 40) {
    return { error: "Use lowercase letters, numbers and single hyphens for the address, up to 40 characters." };
  }
  try {
    await createWorkspace(account, { name, slug });
  } catch (err) {
    return { error: (err as Error).message };
  }
  redirect(`/w/${slug}`);
}

export async function joinWorkspaceAction(_state: FormState, form: FormData): Promise<FormState> {
  const code = String(form.get("code") ?? "").trim();
  const account = await requireAccount(code ? `/join/${encodeURIComponent(code)}` : "/onboarding");
  if (!code) return { error: "Enter an invite code." };
  let slug: string;
  try {
    slug = (await joinWithCode(account, code)).slug;
  } catch (err) {
    return { error: (err as Error).message };
  }
  redirect(`/w/${slug}`);
}
