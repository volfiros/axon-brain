"use client";

import { useState, useTransition, type ComponentProps } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  variant = "outline",
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: ComponentProps<typeof Button>["variant"];
  onConfirm: () => Promise<{ error?: string } | undefined | void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await onConfirm();
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} shape="pill">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-xl font-light">{title}</DialogTitle>
          <DialogDescription className="text-secondary-foreground font-light">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="tab" shape="pill">
              Cancel
            </Button>
          </DialogClose>
          <Button variant={variant} shape="pill" onClick={confirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
