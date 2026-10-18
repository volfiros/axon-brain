"use client";

import { useState } from "react";

import { DecisionStatusBadge } from "@/components/decision-status-badge";
import { RoleBadge } from "@/components/role-badge";
import { Note, SheetField, SourceLink } from "@/components/sheet-field";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PersonView, RankedPerson } from "@/lib/brain/people";

function usePersonSheet(people: PersonView[]) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = people.find((p) => p.id === selectedId);
  const sheet = (
    <Sheet open={open && selected !== undefined} onOpenChange={setOpen}>
      <SheetContent className="sm:max-w-lg">{selected && <PersonDetail person={selected} />}</SheetContent>
    </Sheet>
  );
  return {
    sheet,
    show(id: string) {
      setSelectedId(id);
      setOpen(true);
    },
  };
}

export function PeopleTable({ people }: { people: PersonView[] }) {
  const { sheet, show } = usePersonSheet(people);

  return (
    <>
      <Table variant="rows">
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Role</TableHead>
            <TableHead hideOnMobile>Owns</TableHead>
            <TableHead hideOnMobile>Worked on most</TableHead>
            <TableHead hideOnMobile>Decisions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map((person) => (
            <TableRow key={person.id} className="cursor-pointer" onClick={() => show(person.id)}>
              <TableCell>
                <PersonName name={person.name} title={person.title} />
              </TableCell>
              <TableCell>
                <PersonRole person={person} />
              </TableCell>
              <TableCell hideOnMobile className="max-w-56 text-wrap">
                <Summary names={person.owns.map((i) => i.name)} />
              </TableCell>
              <TableCell hideOnMobile className="max-w-56 text-wrap">
                <Summary names={person.workedOn.map((i) => i.name)} />
              </TableCell>
              <TableCell hideOnMobile className="text-secondary-foreground">
                {person.decisions.length}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {sheet}
    </>
  );
}

export function RankedTable({ ranked, people }: { ranked: RankedPerson[]; people: PersonView[] }) {
  const { sheet, show } = usePersonSheet(people);

  return (
    <>
      <Table variant="rows">
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Score</TableHead>
            <TableHead hideOnMobile>Owns</TableHead>
            <TableHead hideOnMobile>Decisions</TableHead>
            <TableHead hideOnMobile>Authored</TableHead>
            <TableHead hideOnMobile>Worked on</TableHead>
            <TableHead hideOnMobile>Centrality</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ranked.map((person) => (
            <TableRow key={person.personId} className="cursor-pointer" onClick={() => show(person.personId)}>
              <TableCell className="max-w-md text-wrap">
                <div className="flex flex-col gap-2">
                  <PersonName name={person.name} title={person.title} />
                  <ul className="text-secondary-foreground flex flex-col gap-1 text-xs font-light">
                    {person.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              </TableCell>
              <TableCell className="text-2xl font-light">{person.score}</TableCell>
              <Points value={person.breakdown.owns} />
              <Points value={person.breakdown.decisions} />
              <Points value={person.breakdown.authored} />
              <Points value={person.breakdown.workedOn} />
              <Points value={person.breakdown.centrality} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {sheet}
    </>
  );
}

function PersonDetail({ person }: { person: PersonView }) {
  return (
    <>
      <SheetHeader>
        <PersonRole person={person} />
        <SheetTitle>{person.name}</SheetTitle>
        <SheetDescription>{person.title ?? "No title"}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-3 px-4 pb-6">
        <SheetField label="Owns">
          {person.owns.length === 0 && <Note>Nothing you can see</Note>}
          {person.owns.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2">
              <SourceLink href={item.url}>{item.name}</SourceLink>
              <Badge variant="muted">{item.kind}</Badge>
            </div>
          ))}
        </SheetField>
        <SheetField label="Worked on">
          {person.workedOn.length === 0 && <Note>Nothing you can see</Note>}
          {person.workedOn.map((item) => (
            <div key={item.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <SourceLink href={item.url}>{item.name}</SourceLink>
                <Note>{item.count === 1 ? "1 change" : `${item.count} changes`}</Note>
              </div>
              {item.via.length > 0 && <Note>{`Through ${item.via.join(", ")}`}</Note>}
            </div>
          ))}
        </SheetField>
        <SheetField label="Decisions made">
          {person.decisions.length === 0 && <Note>None you can see</Note>}
          {person.decisions.map((decision) => (
            <div key={decision.id} className="flex flex-col gap-1">
              <SourceLink href={decision.url}>{decision.title}</SourceLink>
              <div className="flex items-center gap-2">
                <DecisionStatusBadge status={decision.status} />
                {decision.restricted && <DecisionStatusBadge status="restricted" />}
                <Note>{decision.date}</Note>
              </div>
            </div>
          ))}
        </SheetField>
      </div>
    </>
  );
}

function PersonName({ name, title }: { name: string; title: string | null }) {
  return (
    <div className="flex flex-col">
      <button type="button" className="text-left">
        {name}
      </button>
      {title && <span className="text-secondary-foreground text-xs font-light">{title}</span>}
    </div>
  );
}

function PersonRole({ person }: { person: Pick<PersonView, "role" | "onAxon"> }) {
  if (person.role) return <RoleBadge role={person.role} />;
  return <Badge variant="muted">{person.onAxon ? "Left" : "Not on Axon"}</Badge>;
}

function Summary({ names }: { names: string[] }) {
  if (names.length === 0) return <Note>None</Note>;
  return (
    <span>
      {names[0]}
      {names.length > 1 && <Note>{` and ${names.length - 1} more`}</Note>}
    </span>
  );
}

function Points({ value }: { value: number }) {
  return (
    <TableCell hideOnMobile className={value === 0 ? "text-muted-foreground" : undefined}>
      {value}
    </TableCell>
  );
}
