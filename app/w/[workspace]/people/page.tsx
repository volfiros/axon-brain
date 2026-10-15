import { SearchIcon, UsersIcon } from "lucide-react";
import Form from "next/form";

import { EmptyState } from "@/components/empty-state";
import { FormField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { requireMember } from "@/lib/auth/session";
import { memberContext } from "@/lib/brain/overview";
import { listPeople, rankPeople } from "@/lib/brain/people";

import { PeopleTable, RankedTable } from "./people-table";
import { SearchButton } from "./search-button";

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ topic?: string }>;
}) {
  const { workspace: slug } = await params;
  const topic = (await searchParams).topic?.trim() ?? "";
  const { workspace, member } = await requireMember(slug, `/w/${slug}/people`);
  const ctx = memberContext(slug, member);
  const [people, ranked] = await Promise.all([listPeople(ctx), topic ? rankPeople(ctx, topic) : null]);

  return (
    <>
      <PageHeader title="People" description={workspace.name} />
      <Form action={`/w/${slug}/people`} className="flex items-end gap-2">
        <div className="flex-1">
          <FormField id="topic" label="Who knows about" defaultValue={topic} placeholder="refunds" autoComplete="off" />
        </div>
        <SearchButton />
      </Form>
      {topic && (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xl font-light">{`Who knows about "${topic}"`}</h2>
          {ranked === null && (
            <EmptyState icon={<SearchIcon />} title="Name a topic, file or process to rank people for" />
          )}
          {ranked?.length === 0 && (
            <EmptyState icon={<SearchIcon />} title="No one is linked to this yet" description="Try a file path or another word." />
          )}
          {ranked && ranked.length > 0 && <RankedTable ranked={ranked} people={people} />}
        </section>
      )}
      <section className="flex flex-col gap-2">
        {topic && <h2 className="text-2xl font-light">Everyone</h2>}
        {people.length === 0 ? (
          <EmptyState icon={<UsersIcon />} title="No people yet" />
        ) : (
          <PeopleTable people={people} />
        )}
      </section>
    </>
  );
}
