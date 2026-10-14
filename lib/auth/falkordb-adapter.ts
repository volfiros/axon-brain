import { createAdapterFactory, type CleanedWhere } from "better-auth/adapters";

import { accountsGraph, type Params, type Row } from "@/lib/graph/client";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

// Better Auth calls the sign-in identity "user" and its password record "account"; the glossary calls them Account and Credential.
const LABELS: Record<string, string> = { user: "Account", account: "Credential" };

function label(model: string): string {
  const name = LABELS[model] ?? model.charAt(0).toUpperCase() + model.slice(1);
  return `\`${safe(name)}\``;
}

function safe(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Unsafe graph identifier: ${name}`);
  return name;
}

function withoutNulls(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null && value !== undefined));
}

function condition(clause: CleanedWhere, param: string): string {
  const field = `n.\`${safe(clause.field)}\``;
  const insensitive = clause.mode === "insensitive";
  const left = insensitive ? `toLower(${field})` : field;
  const right = insensitive ? `toLower($${param})` : `$${param}`;
  switch (clause.operator) {
    case "ne":
      return clause.value === null ? `${field} IS NOT NULL` : `${left} <> ${right}`;
    case "lt":
      return `${field} < $${param}`;
    case "lte":
      return `${field} <= $${param}`;
    case "gt":
      return `${field} > $${param}`;
    case "gte":
      return `${field} >= $${param}`;
    case "in":
      return insensitive ? `toLower(${field}) IN [v IN $${param} | toLower(v)]` : `${field} IN $${param}`;
    case "not_in":
      return insensitive ? `NOT toLower(${field}) IN [v IN $${param} | toLower(v)]` : `NOT ${field} IN $${param}`;
    case "contains":
      return `${left} CONTAINS ${right}`;
    case "starts_with":
      return `${left} STARTS WITH ${right}`;
    case "ends_with":
      return `${left} ENDS WITH ${right}`;
    default:
      return clause.value === null ? `${field} IS NULL` : `${left} = ${right}`;
  }
}

// Clauses fold left to right with their own connector, matching Better Auth's memory adapter.
function whereClause(where: CleanedWhere[] | undefined, params: Params): string {
  if (!where?.length) return "";
  let expression = "";
  where.forEach((clause, i) => {
    const param = `w${i}`;
    params[param] = clause.value as Params[string];
    const part = condition(clause, param);
    expression = i === 0 ? part : `(${expression}) ${clause.connector === "OR" ? "OR" : "AND"} ${part}`;
  });
  return `WHERE ${expression}`;
}

type Props = { p: Row };

export const falkordbAdapter = () =>
  createAdapterFactory({
    config: {
      adapterId: "falkordb",
      adapterName: "FalkorDB",
      supportsNumericIds: false,
      supportsJSON: false,
      supportsDates: false,
      supportsBooleans: true,
      supportsArrays: false,
      transaction: false,
    },
    adapter: ({ schema, getModelName, getFieldName }) => {
      const graph = accountsGraph();
      let indexes: Promise<void> | undefined;

      // Indexes are created lazily once per process so lookups by id, token or email stay indexed.
      function ensureIndexes(): Promise<void> {
        indexes ??= (async () => {
          for (const [key, table] of Object.entries(schema)) {
            const model = getModelName(key);
            const fields = Object.entries(table.fields)
              .filter(([, attr]) => attr.unique || attr.index || attr.references)
              .map(([field]) => getFieldName({ model: key, field }));
            for (const field of ["id", ...fields]) {
              try {
                await graph.query(`CREATE INDEX FOR (n:${label(model)}) ON (n.\`${safe(field)}\`)`);
              } catch (err) {
                if (!/already indexed/i.test((err as Error).message)) throw err;
              }
            }
          }
        })().catch((err) => {
          indexes = undefined;
          throw err;
        });
        return indexes;
      }

      async function run(cypher: string, params: Params): Promise<Row[]> {
        await ensureIndexes();
        const rows = await graph.query<Props>(cypher, params);
        return rows.map((row) => row.p);
      }

      async function count(cypher: string, params: Params): Promise<number> {
        await ensureIndexes();
        const [row] = await graph.query<{ c: number }>(cypher, params);
        return row?.c ?? 0;
      }

      return {
        async create({ model, data }) {
          const [created] = await run(`CREATE (n:${label(model)}) SET n = $data RETURN properties(n) AS p`, {
            data: withoutNulls(data) as Params[string],
          });
          return created as typeof data;
        },

        async findOne({ model, where }) {
          const params: Params = {};
          const [found] = await run(
            `MATCH (n:${label(model)}) ${whereClause(where, params)} RETURN properties(n) AS p LIMIT 1`,
            params,
          );
          return (found ?? null) as never;
        },

        async findMany({ model, where, limit, offset, sortBy }) {
          const params: Params = {};
          const order = sortBy
            ? `ORDER BY n.\`${safe(sortBy.field)}\` ${sortBy.direction === "desc" ? "DESC" : "ASC"}`
            : "";
          const skip = offset ? `SKIP ${Math.trunc(offset)}` : "";
          const take = limit ? `LIMIT ${Math.trunc(limit)}` : "";
          return (await run(
            `MATCH (n:${label(model)}) ${whereClause(where, params)} RETURN properties(n) AS p ${order} ${skip} ${take}`,
            params,
          )) as never;
        },

        async count({ model, where }) {
          const params: Params = {};
          return count(`MATCH (n:${label(model)}) ${whereClause(where, params)} RETURN count(n) AS c`, params);
        },

        async update({ model, where, update }) {
          const params: Params = { data: update as Params[string] };
          const [updated] = await run(
            `MATCH (n:${label(model)}) ${whereClause(where, params)} WITH n LIMIT 1 SET n += $data RETURN properties(n) AS p`,
            params,
          );
          return (updated ?? null) as never;
        },

        async updateMany({ model, where, update }) {
          const params: Params = { data: update as Params[string] };
          return count(
            `MATCH (n:${label(model)}) ${whereClause(where, params)} SET n += $data RETURN count(n) AS c`,
            params,
          );
        },

        async delete({ model, where }) {
          const params: Params = {};
          await run(`MATCH (n:${label(model)}) ${whereClause(where, params)} WITH n LIMIT 1 DETACH DELETE n RETURN {} AS p`, params);
        },

        async deleteMany({ model, where }) {
          const params: Params = {};
          return count(
            `MATCH (n:${label(model)}) ${whereClause(where, params)} WITH collect(n) AS ns, count(n) AS c FOREACH (x IN ns | DETACH DELETE x) RETURN c`,
            params,
          );
        },

        // A single FalkorDB query runs atomically, so read and delete in one statement is race-safe.
        async consumeOne({ model, where }) {
          const params: Params = {};
          const [consumed] = await run(
            `MATCH (n:${label(model)}) ${whereClause(where, params)} WITH n LIMIT 1 WITH n, properties(n) AS p DETACH DELETE n RETURN p`,
            params,
          );
          return (consumed ?? null) as never;
        },
      };
    },
  });
