import type { AxonGraph } from "./client";

const CORE_LABELS = [
  "Person",
  "Team",
  "Role",
  "Project",
  "WorkItem",
  "CodeUnit",
  "Process",
  "Decision",
  "Constraint",
  "Assumption",
  "Alternative",
  "Topic",
  "Source",
  "Excerpt",
  "ExternalParty",
  "Feedback",
];

const RANGE_INDEXES: [label: string, property: string][] = [
  ...CORE_LABELS.map((label): [string, string] => [label, "id"]),
  ["Person", "account_id"],
  ["CodeUnit", "path"],
  ["Decision", "status"],
];

const FULLTEXT_INDEXES: [label: string, properties: string[]][] = [
  ["Decision", ["title", "statement"]],
  ["Excerpt", ["text"]],
];

function indexStatements(): string[] {
  const statements = RANGE_INDEXES.map(
    ([label, property]) => `CREATE INDEX FOR (n:${label}) ON (n.${property})`,
  );
  for (const [label, properties] of FULLTEXT_INDEXES) {
    const args = [label, ...properties].map((p) => `'${p}'`).join(", ");
    statements.push(`CALL db.idx.fulltext.createNodeIndex(${args})`);
  }
  const dimension = Number(process.env.EMBEDDING_DIMENSION);
  if (Number.isInteger(dimension) && dimension > 0) {
    statements.push(
      `CREATE VECTOR INDEX FOR (n:Decision) ON (n.embedding) OPTIONS {dimension: ${dimension}, similarityFunction: 'cosine'}`,
    );
  }
  return statements;
}

/** Creates every index a Workspace graph needs. Safe to run again on an existing graph. */
export async function ensureWorkspaceSchema(graph: AxonGraph): Promise<void> {
  for (const statement of indexStatements()) {
    try {
      await graph.query(statement);
    } catch (err) {
      if (!/already indexed/i.test((err as Error).message)) throw err;
    }
  }
}
