import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { requireAccount } from "@/lib/auth/session";

import { NameForm, PasswordForm } from "./account-forms";

export default async function AccountPage() {
  const account = await requireAccount("/account");
  return (
    <PageShell account={account}>
      <PageHeader title="Account settings" description={account.username ?? account.name} />
      <div className="grid gap-6 md:grid-cols-2">
        <NameForm name={account.name} />
        <PasswordForm />
      </div>
    </PageShell>
  );
}
