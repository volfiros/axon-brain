import { DecisionStatusBadge } from "@/components/decision-status-badge";
import { TextLink } from "@/components/text-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AnswerView } from "@/lib/brain/answers";

export function AnswersTable({ answers, slug }: { answers: AnswerView[]; slug: string }) {
  return (
    <Table variant="rows">
      <TableHeader>
        <TableRow>
          <TableHead>Answer</TableHead>
          <TableHead>Status</TableHead>
          <TableHead hideOnMobile>Saved by</TableHead>
          <TableHead hideOnMobile>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {answers.map((answer) => (
          <TableRow key={answer.id}>
            <TableCell className="max-w-md text-wrap">
              <div className="flex flex-col gap-1.5">
                <span>{answer.question}</span>
                <ol className="text-secondary-foreground flex list-decimal flex-col gap-1 pl-4 font-light">
                  {answer.statements.map((statement) => (
                    <li key={statement.text}>
                      {statement.text}{" "}
                      {statement.cites.map((cite) => (
                        <TextLink key={cite.id} href={`/w/${slug}?decision=${cite.id}`} className="text-secondary-foreground mr-2">
                          {cite.title}
                        </TextLink>
                      ))}
                    </li>
                  ))}
                </ol>
                {answer.status === "stale" && (
                  <span className="text-secondary-foreground font-light">
                    {answer.staleReason} on {answer.staleAt}.
                    {answer.replacedBy && (
                      <>
                        {" "}Replaced by <TextLink href={`/w/${slug}?decision=${answer.replacedBy.id}`}>{answer.replacedBy.title}</TextLink>.
                      </>
                    )}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell>
              <DecisionStatusBadge status={answer.status} />
            </TableCell>
            <TableCell hideOnMobile className="text-secondary-foreground">
              {answer.savedBy ?? "Unknown"}
            </TableCell>
            <TableCell hideOnMobile className="text-secondary-foreground">
              {answer.savedAt}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
