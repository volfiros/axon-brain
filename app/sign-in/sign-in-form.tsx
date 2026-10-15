"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { AuthCard } from "@/components/auth-card";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { TextLink } from "@/components/text-link";
import { Button } from "@/components/ui/button";
import { authClient, followAuthRedirect, safeNextPath } from "@/lib/auth/client";

export function SignInForm() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => setSearch(window.location.search), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const identifier = String(form.get("identifier")).trim();
    const password = String(form.get("password"));
    setPending(true);
    setError(null);
    const { data, error } = identifier.includes("@")
      ? await authClient.signIn.email({ email: identifier, password })
      : await authClient.signIn.username({ username: identifier, password });
    if (error) {
      setError(error.message ?? "Sign-in failed.");
      setPending(false);
      return;
    }
    if (followAuthRedirect(data)) return;
    router.push(safeNextPath(new URLSearchParams(search).get("next")));
    router.refresh();
  }

  return (
    <AuthCard
      title="Sign in to Axon"
      footer={
        <span>
          No account yet?{" "}
          <TextLink href={`/sign-up${search}`}>
            Create one
          </TextLink>
        </span>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <FormField id="identifier" label="Username or email" autoComplete="username" required />
        <FormField id="password" label="Password" type="password" autoComplete="current-password" required />
        <FormError message={error} />
        <Button type="submit" size="lg" shape="pill" disabled={pending}>
          {pending ? "Signing in" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
