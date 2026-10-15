"use client";

import { useState } from "react";

import { RoleBadge } from "@/components/role-badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Member } from "@/lib/workspaces";

import { RoleSelect } from "./role-select";

export function MembersTable({ slug, members, isAdmin }: { slug: string; members: Member[]; isAdmin: boolean }) {
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
            <TableRow key={person.personId} className="cursor-pointer" onClick={() => {
                setSelectedId(person.personId);
                setOpen(true);
              }}>
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
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
