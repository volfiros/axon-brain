"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { AuthCard } from "@/components/auth-card";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { TextLink } from "@/components/text-link";
import { Button } from "@/components/ui/button";
import { authClient, followAuthRedirect, safeNextPath } from "@/lib/auth/client";

export function SignUpForm() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => setSearch(window.location.search), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signUp.email({
      name: String(form.get("name")).trim(),
      username: String(form.get("username")).trim(),
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });
    if (error) {
      setError(error.message ?? "Sign-up failed.");
      setPending(false);
      return;
    }
    if (followAuthRedirect(data)) return;
    router.push(safeNextPath(new URLSearchParams(search).get("next")));
    router.refresh();
  }

  return (
    <AuthCard
      title="Create your Axon account"
      footer={
        <span>
          Already have an account?{" "}
          <TextLink href={`/sign-in${search}`}>
            Sign in
          </TextLink>
        </span>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <FormField id="name" label="Name" autoComplete="name" required />
        <FormField id="username" label="Username" autoComplete="username" minLength={3} maxLength={30} required />
        <FormField id="email" label="Email" type="email" autoComplete="email" required />
        <FormField id="password" label="Password" type="password" autoComplete="new-password" minLength={8} required />
        <FormError message={error} />
        <Button type="submit" variant="brand" size="lg" shape="pill" disabled={pending}>
          {pending ? "Creating account" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
