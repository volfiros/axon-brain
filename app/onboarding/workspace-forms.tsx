"use client";

import { useActionState, useState } from "react";

import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { createWorkspaceAction, joinWorkspaceAction } from "./actions";

export function CreateWorkspaceForm({ host }: { host: string }) {
  const [state, action, pending] = useActionState(createWorkspaceAction, {});
  const [slug, setSlug] = useState(state.values?.slug ?? "");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a workspace</CardTitle>
        <CardDescription>You become its Admin.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <FormField id="name" label="Company name" defaultValue={state.values?.name} required />
          <FormField
            id="slug"
            label="Address"
            placeholder="acme"
            defaultValue={state.values?.slug}
            onChange={(e) => setSlug(e.target.value.trim().toLowerCase())}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={40}
            required
            hint={`${host}/w/${slug || "acme"}. It can't be changed later.`}
          />
          <FormError message={state.error} />
          <Button type="submit" variant="brand" size="lg" shape="pill" loading={pending}>
            {pending ? "Creating" : "Create workspace"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function JoinWorkspaceForm() {
  const [state, action, pending] = useActionState(joinWorkspaceAction, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Join with an invite code</CardTitle>
        <CardDescription>An Admin of the workspace can give you one.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <FormField id="code" label="Invite code" defaultValue={state.values?.code} autoComplete="off" required />
          <FormError message={state.error} />
          <Button type="submit" variant="secondary" size="lg" shape="pill" loading={pending}>
            {pending ? "Joining" : "Join workspace"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
