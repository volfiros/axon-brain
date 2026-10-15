import { redirect } from "next/navigation";

import { requireAccount } from "@/lib/auth/session";

export default async function Home() {
  await requireAccount("/onboarding");
  redirect("/onboarding");
}
