"use client";

import { useActionState, useState, type FormEvent } from "react";

import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";

import { changeNameAction } from "./actions";

export function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(changeNameAction, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Display name</CardTitle>
        <CardDescription>Shown on decisions you make and in member lists.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <FormField id="name" label="Name" defaultValue={name} autoComplete="name" maxLength={80} required />
          <FormError message={state.error} />
          {state.saved && <p className="text-secondary-foreground text-sm font-light">Name saved.</p>}
          <Button type="submit" size="lg" shape="pill" disabled={pending}>
            {pending ? "Saving" : "Save name"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// Called from the browser so Better Auth's rotated session cookie lands directly; the endpoint checks the session itself.
export function PasswordForm() {
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newPassword = String(form.get("newPassword"));
    if (newPassword !== String(form.get("confirmPassword"))) {
      setState({ error: "The new passwords do not match." });
      return;
    }
    setPending(true);
    const { error } = await authClient.changePassword({
      currentPassword: String(form.get("currentPassword")),
      newPassword,
      revokeOtherSessions: form.get("revokeOtherSessions") === "on",
    });
    setPending(false);
    if (error) {
      setState({ error: error.message ?? "Password not changed." });
      return;
    }
    formElement.reset();
    setState({ saved: true });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>At least 8 characters.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <FormField
            id="currentPassword"
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
          />
          <FormField id="newPassword" label="New password" type="password" autoComplete="new-password" minLength={8} required />
          <FormField
            id="confirmPassword"
            label="Repeat new password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <div className="flex items-center gap-2">
            <input id="revokeOtherSessions" name="revokeOtherSessions" type="checkbox" defaultChecked className="accent-foreground" />
            <Label htmlFor="revokeOtherSessions" className="text-secondary-foreground text-sm font-light">
              Sign out of other devices
            </Label>
          </div>
          <FormError message={state.error} />
          {state.saved && <p className="text-secondary-foreground text-sm font-light">Password changed.</p>}
          <Button type="submit" size="lg" shape="pill" disabled={pending}>
            {pending ? "Changing" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
