"use client";

import { useState } from "react";

import { ConfirmButton } from "@/components/confirm-button";
import { DecisionStatusBadge } from "@/components/decision-status-badge";
import { DecidedFields, Note, SheetField as Field } from "@/components/sheet-field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DecisionView } from "@/lib/brain/overview";

import { stillHoldsAction } from "./actions";

export function DecisionsTable({
  decisions,
  slug,
  canWrite,
  initialId,
}: {
  decisions: DecisionView[];
  slug: string;
  canWrite: boolean;
  initialId?: string;
}) {
  const [open, setOpen] = useState(initialId !== undefined);
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const selected = decisions.find((d) => d.id === selectedId);

  return (
    <>
      <Table variant="rows">
        <TableHeader>
          <TableRow>
            <TableHead>Decision</TableHead>
            <TableHead>Status</TableHead>
            <TableHead hideOnMobile>Made by</TableHead>
            <TableHead hideOnMobile>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {decisions.map((decision) => (
            <TableRow
              key={decision.id}
              className="cursor-pointer"
              onClick={() => {
                setSelectedId(decision.id);
                setOpen(true);
              }}
            >
              <TableCell className="max-w-md text-wrap">
                <button type="button" className="text-left">
                  {decision.title}
                </button>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <DecisionStatusBadge status={decision.status} />
                  {decision.restricted && <DecisionStatusBadge status="restricted" />}
                  {decision.sourceChanges.length > 0 && <DecisionStatusBadge status="changed" />}
          {decision.codeChanges.length > 0 && <DecisionStatusBadge status="stale" />}
                </div>
              </TableCell>
              <TableCell hideOnMobile className="text-secondary-foreground">
                {decision.maker ?? "Unknown"}
              </TableCell>
              <TableCell hideOnMobile className="text-secondary-foreground">
                {decision.date}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Sheet open={open && selected !== undefined} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-lg">
          {selected && <DecisionDetail decision={selected} slug={slug} canWrite={canWrite} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function DecisionDetail({ decision, slug, canWrite }: { decision: DecisionView; slug: string; canWrite: boolean }) {
  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap gap-2">
          <DecisionStatusBadge status={decision.status} />
          {decision.restricted && <DecisionStatusBadge status="restricted" />}
          {decision.sourceChanges.length > 0 && <DecisionStatusBadge status="changed" />}
          {decision.codeChanges.length > 0 && <DecisionStatusBadge status="stale" />}
        </div>
        <SheetTitle>{decision.title}</SheetTitle>
        <SheetDescription>{decision.statement}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-3 px-4 pb-6">
        <Field label="Because">
          <List items={decision.because} empty="No reason you can see" />
          {decision.hiddenReasons && <Note>{decision.hiddenReasons}</Note>}
        </Field>
        <Field label="Rejected alternatives">
          <List items={decision.rejected} empty="No alternatives recorded" />
        </Field>
        <Field label="Affects">
          <List items={decision.affects} empty="Nothing linked" />
        </Field>
        <DecidedFields maker={decision.maker} approver={decision.approver} date={decision.date} replaced={decision.replaced} />
        <Field label="Source">
          {decision.sources.length === 0 && <Note>None you can see</Note>}
          {decision.sources.map((source) => (
            <div key={`${source.title}-${source.quote}`} className="flex flex-col gap-1">
              <q className="font-light">{source.quote}</q>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer" className="text-secondary-foreground underline-offset-4 hover:underline">
                  {source.title}
                </a>
              ) : (
                <span className="text-secondary-foreground">{source.title}</span>
              )}
            </div>
          ))}
          {decision.hiddenSources && <Note>{decision.hiddenSources}</Note>}
        </Field>
        {decision.sourceChanges.length > 0 && (
          <Field label="Source changed">
            {decision.sourceChanges.map((change) => (
              <span key={change.title}>
                {change.title} was {change.change} on {change.date}. Check that the decision still holds, or supersede it.
              </span>
            ))}
            {canWrite && (
              <div>
                <ConfirmButton
                  label="Still holds"
                  title="Confirm this decision still holds"
                  description="The decision stays accepted and the changed source is marked as checked."
                  confirmLabel="Still holds"
                  onConfirm={() => stillHoldsAction(slug, decision.id)}
                />
              </div>
            )}
          </Field>
        )}
        {decision.codeChanges.length > 0 && (
          <Field label="Code changed since">
            {decision.codeChanges.map((change) => (
              <span key={`${change.title}-${change.date}`}>
                {change.date}{" "}
                {change.url ? (
                  <a href={change.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                    {change.title}
                  </a>
                ) : (
                  change.title
                )}
              </span>
            ))}
          </Field>
        )}
        {decision.supersedes.length > 0 && (
          <Field label="Supersedes">
            <List items={decision.supersedes} empty="" />
          </Field>
        )}
        {decision.supersededBy.length > 0 && (
          <Field label="Superseded by">
            <List items={decision.supersededBy} empty="" />
          </Field>
        )}
      </div>
    </>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <Note>{empty}</Note>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
