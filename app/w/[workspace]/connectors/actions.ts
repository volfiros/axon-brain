"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { requireAccount } from "@/lib/auth/session";
import { assertAdmin, deleteConnector, isProvider, loadSecrets } from "@/lib/connectors/credentials";
import { disconnectGithub, githubConnection, setStatus, syncInstallation } from "@/lib/connectors/github/connection";
import { connectPlane, removePlaneWebhook, savePlaneWebhookSecret } from "@/lib/connectors/plane/connect";
import { beginSync, resolvePlane, resolveSlack, runSync } from "@/lib/connectors/sync";

export type ConnectorKey = "github" | "slack" | "plane";
export type FormResult = { error?: string; ok?: boolean };

async function adminRun(slug: string, change: (accountId: string) => Promise<void>): Promise<FormResult> {
  const account = await requireAccount(`/w/${slug}/connectors`);
  try {
    await assertAdmin(slug, account.id);
    await change(account.id);
  } catch (err) {
    return { error: (err as Error).message };
  }
  revalidatePath(`/w/${slug}/connectors`);
  return { ok: true };
}

async function startSync(slug: string, provider: "slack" | "plane") {
  const since = await beginSync(slug, provider);
  after(() => runSync(slug, provider, since).catch((err) => console.error(`${provider} sync for ${slug} failed:`, err)));
}

export async function syncNowAction(slug: string, key: ConnectorKey): Promise<FormResult> {
  return adminRun(slug, async () => {
    if (key === "github") {
      const connection = await githubConnection(slug);
      if (!connection) throw new Error("GitHub is not connected");
      const since = connection.status === "synced" && connection.synced_at ? `${connection.synced_at}Z` : undefined;
      await setStatus(connection.installation_id, "syncing");
      after(() =>
        syncInstallation(slug, connection.installation_id, since).catch((err) => console.error(`GitHub sync for ${slug} failed:`, err)),
      );
      return;
    }
    if (!isProvider(key)) throw new Error("Unknown connector");
    const connected = key === "plane" ? await resolvePlane(slug) : await resolveSlack(slug);
    if (!connected) throw new Error(`${key === "plane" ? "Plane" : "Slack"} is not connected`);
    await startSync(slug, key);
  });
}

export async function disconnectAction(slug: string, key: ConnectorKey): Promise<FormResult> {
  return adminRun(slug, async () => {
    if (key === "github") return disconnectGithub(slug);
    if (!isProvider(key)) throw new Error("Unknown connector");
    if (key === "plane") await removePlaneWebhook(slug);
    const { token } = key === "slack" ? await loadSecrets(slug, "slack") : {};
    if (token) {
      await fetch("https://slack.com/api/auth.revoke", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(
        () => undefined,
      );
    }
    await deleteConnector(slug, key);
  });
}

export async function connectPlaneAction(slug: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  return adminRun(slug, async (accountId) => {
    await connectPlane(slug, accountId, {
      apiKey: String(form.get("apiKey") ?? ""),
      workspaceSlug: String(form.get("workspaceSlug") ?? ""),
      apiUrl: String(form.get("apiUrl") ?? ""),
    });
    await startSync(slug, "plane");
  });
}

export async function savePlaneSecretAction(slug: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  return adminRun(slug, (accountId) => savePlaneWebhookSecret(slug, accountId, String(form.get("webhookSecret") ?? "")));
}
