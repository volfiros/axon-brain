import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";

export function WorkspaceNav({ slug }: { slug: string }) {
  return (
    <>
      <Button variant="ghost" size="sm" asChild>
        <Link href="/onboarding">Workspaces</Link>
      </Button>
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/w/${slug}/setup`}>Setup</Link>
      </Button>
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/w/${slug}/members`}>Members</Link>
      </Button>
      <SignOutButton />
    </>
  );
}
