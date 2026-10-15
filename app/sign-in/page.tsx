import { PageShell } from "@/components/page-shell";

import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  return (
    <PageShell width="narrow">
      <SignInForm />
    </PageShell>
  );
}
