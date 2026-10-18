"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";

import { disconnectAction, syncNowAction, type ConnectorKey } from "./actions";

export function ConnectorActions({
  slug,
  connector,
  title,
  canSync,
  canDisconnect,
}: {
  slug: string;
  connector: ConnectorKey;
  title: string;
  canSync: boolean;
  canDisconnect: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function sync() {
    startTransition(async () => {
      const { error } = await syncNowAction(slug, connector);
      if (error) toast.error(error);
    });
  }

  return (
    <>
      {canSync && (
        <Button variant="secondary" shape="pill" onClick={sync} loading={pending}>
          Sync now
        </Button>
      )}
      {canDisconnect && (
        <ConfirmButton
          label="Disconnect"
          title={`Disconnect ${title}?`}
          description="Axon deletes the stored credentials and stops syncing. Sources already imported stay in the graph."
          confirmLabel="Disconnect"
          variant="destructive"
          onConfirm={() => disconnectAction(slug, connector)}
        />
      )}
    </>
  );
}

export function RefreshWhileSyncing({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
