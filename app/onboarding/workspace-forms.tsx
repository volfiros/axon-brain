"use client";

import { useActionState } from "react";

import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { createWorkspaceAction, joinWorkspaceAction } from "./actions";

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspaceAction, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a workspace</CardTitle>
        <CardDescription>You become its Admin.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <FormField id="name" label="Company name" required />
          <FormField
            id="slug"
            label="Address"
            placeholder="acme"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={40}
            required
          />
          <FormError message={state.error} />
          <Button type="submit" disabled={pending}>
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
          <FormField id="code" label="Invite code" autoComplete="off" required />
          <FormError message={state.error} />
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Joining" : "Join workspace"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
