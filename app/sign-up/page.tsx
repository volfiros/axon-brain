import { PageShell } from "@/components/page-shell";
import { redirectSignedIn } from "@/lib/auth/redirect-signed-in";

import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectSignedIn(await searchParams);
  return (
    <PageShell width="narrow">
      <SignUpForm />
    </PageShell>
  );
}
