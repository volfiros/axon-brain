import { PageShell } from "@/components/page-shell";
import { redirectSignedIn } from "@/lib/auth/redirect-signed-in";

import { SignInForm } from "./sign-in-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectSignedIn(await searchParams);
  return (
    <PageShell width="narrow">
      <SignInForm />
    </PageShell>
  );
}
