"use client";

import { useState } from "react";

import { ConfirmButton } from "@/components/confirm-button";
import { RoleBadge } from "@/components/role-badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Member } from "@/lib/workspaces";

import { removeMemberAction } from "./actions";
import { RoleSelect } from "./role-select";

export function MembersTable({
  slug,
  members,
  isAdmin,
  selfId,
}: {
  slug: string;
  members: Member[];
  isAdmin: boolean;
  selfId: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = members.find((person) => person.personId === selectedId);

  return (
    <>
      <Table variant="rows">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Username</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((person) => (
            <TableRow
              key={person.personId}
              className="cursor-pointer"
              onClick={() => {
                setSelectedId(person.personId);
                setOpen(true);
              }}
            >
              <TableCell>
                <button type="button" className="text-left">
                  {person.name}
                </button>
              </TableCell>
              <TableCell className="text-secondary-foreground">{person.handle}</TableCell>
              <TableCell>
                <RoleBadge role={person.role} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Sheet open={open && selected !== undefined} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="text-2xl font-light">{selected.name}</SheetTitle>
                <SheetDescription className="text-secondary-foreground font-light">
                  {selected.handle ?? "No username"}
                </SheetDescription>
              </SheetHeader>
              <div className="bg-surface text-surface-foreground mx-4 flex flex-col gap-4 rounded-2xl p-4">
                <span className="text-secondary-foreground text-xs font-light">Role</span>
                {isAdmin ? (
                  <RoleSelect key={selected.personId} slug={slug} personId={selected.personId} role={selected.role} />
                ) : (
                  <RoleBadge role={selected.role} />
                )}
              </div>
              {isAdmin && selected.personId !== selfId && (
                <div className="px-4">
                  <ConfirmButton
                    label="Remove from workspace"
                    title={`Remove ${selected.name}?`}
                    description="They lose access right away. Decisions they made stay in the brain."
                    confirmLabel="Remove"
                    variant="destructive"
                    onConfirm={async () => {
                      const result = await removeMemberAction(slug, selected.personId);
                      if (!result.error) setOpen(false);
                      return result;
                    }}
                  />
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
