"use client";

import { useActionState } from "react";

import { CodeSnippet } from "@/components/code-snippet";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";

import { connectPlaneAction, savePlaneSecretAction } from "./actions";

export function PlaneConnectForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(connectPlaneAction.bind(null, slug), {});
  return (
    <form action={action} className="flex w-full flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="apiKey" label="API key" type="password" autoComplete="off" required />
        <FormField id="workspaceSlug" label="Workspace slug" placeholder="acme" autoComplete="off" required />
      </div>
      <FormField id="apiUrl" label="API URL for self-hosted Plane" placeholder="https://api.plane.so" type="url" />
      <FormError message={state.error} />
      <Button type="submit" variant="brand" shape="pill" className="self-start" loading={pending}>
        {pending ? "Checking" : "Connect Plane"}
      </Button>
    </form>
  );
}

export function PlaneWebhookForm({ slug, webhookUrl }: { slug: string; webhookUrl: string }) {
  const [state, action, pending] = useActionState(savePlaneSecretAction.bind(null, slug), {});
  return (
    <form action={action} className="flex w-full flex-col gap-4">
      <p className="text-secondary-foreground text-sm font-light">
        Plane did not accept the webhook through its API. In Plane, open Workspace settings, Webhooks, add this URL with
        project, work item and comment events, then paste the secret key Plane gives you.
      </p>
      <CodeSnippet code={webhookUrl} label="webhook URL" />
      <FormField id="webhookSecret" label="Webhook secret" type="password" autoComplete="off" required />
      <FormError message={state.error} />
      <Button type="submit" variant="secondary" shape="pill" className="self-start" loading={pending}>
        Save secret
      </Button>
    </form>
  );
}
