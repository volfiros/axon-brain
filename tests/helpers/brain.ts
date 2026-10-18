import type { Caller } from "@/lib/brain/caller";
import type { BrainContext, BrainTool } from "@/lib/brain/tool";
import { resolveItem, writeItem, type ItemInput, type SourceRef, type WriteOptions } from "@/lib/brain/write";
import { workspaceGraph } from "@/lib/graph/client";
import type { Role } from "@/lib/roles";

import { seedMember } from "./fixtures";

/** A member of `slug` with the BrainContext the MCP server would build for them. */
export async function seedCaller(slug: string, accountId: string, role: Role, name: string): Promise<BrainContext> {
  const personId = await seedMember(slug, accountId, role, name);
  return contextFor(slug, { personId, name, role });
}

export function contextFor(slug: string, who: { personId: string; name: string; role: Role }): BrainContext {
  const caller: Caller = { ...who, teams: [], workspace: slug };
  return { graph: workspaceGraph(slug), caller };
}

/** A Team with the given Person ids as MEMBER_OF. Teams have no write path in the app yet. */
export async function seedTeam(slug: string, name: string, personIds: string[]): Promise<void> {
  await workspaceGraph(slug).query(
    `CREATE (t:Team {id: $id, name: $name})
     WITH t UNWIND $personIds AS pid
     MATCH (p:Person {id: pid}) CREATE (p)-[:MEMBER_OF]->(t)`,
    { id: `team_${name.toLowerCase()}`, name, personIds },
  );
}

/** A restricted conversation Source visible to the Admin Role and one Team, as a connector would write for a private channel. */
export async function seedTeamSource(slug: string, sourceId: string, teamName: string): Promise<void> {
  await workspaceGraph(slug).query(
    `MATCH (admin:Role {name: 'Admin'}), (t:Team {name: $teamName})
     CREATE (s:Source:Conversation {id: $sourceId, title: $sourceId, sensitivity: 'restricted', created_at: localdatetime()})
     CREATE (s)-[:VISIBLE_TO]->(admin), (s)-[:VISIBLE_TO]->(t)`,
    { sourceId, teamName },
  );
}

type ItemFields = Partial<ItemInput> & Pick<ItemInput, "statement">;

/** Writes a decision, constraint, assumption or note through resolveItem and writeItem, as save does after confirm. */
export async function saveItem(
  ctx: BrainContext,
  fields: ItemFields,
  source?: SourceRef,
  options?: WriteOptions,
): Promise<{ itemId: string; sourceId: string }> {
  const input: ItemInput = {
    kind: "decision",
    because_ids: [],
    new_constraints: [],
    new_assumptions: [],
    rejected: [],
    affects: [],
    about: [],
    excerpt: fields.statement,
    source_title: "Planning chat",
    ...fields,
  };
  const plan = await resolveItem(ctx, input);
  return writeItem(ctx, plan, source ?? { title: input.source_title }, options);
}

/** Calls a brain tool the way the MCP server does: the input goes through the tool's schema first. */
export function callTool(tool: BrainTool, input: Record<string, unknown>, ctx: BrainContext): Promise<string> {
  return tool.handler(tool.inputSchema.parse(input), ctx);
}
