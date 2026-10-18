import type { Role } from "@/lib/roles";

import { FROM_CALLER, readAsCaller, shown, visible } from "./access";
import { personCentrality } from "./centrality";
import type { DecisionStatus } from "./overview";
import { day, searchTerms } from "./search";
import type { BrainContext } from "./tool";

const TARGET = `
  ${FROM_CALLER}
  MATCH (x)
  WHERE (x:Topic OR x:CodeUnit OR x:Process OR x:Project)
    AND any(w IN $stems WHERE toLower(x.name) CONTAINS w OR toLower(coalesce(x.path, '')) CONTAINS w)
    AND ${shown("x")}`;

const NAME = "coalesce(x.path, x.name)";
const PERSON = "p.id AS personId, p.name AS name, p.title AS title, p.account_id IS NOT NULL AS onAxon";

// One row per signal; points: owns 5, made a current decision 3 (superseded 1), approved 2, authored a source 2, 0.5 per recorded change.
const SCORING = `
  ${TARGET}
  MATCH (p:Person)-[:OWNS]->(x)
  WITH DISTINCT p, x
  RETURN ${PERSON}, 'owns' AS kind, 'owns ' + ${NAME} AS signal, 5.0 AS points
  UNION ALL
  ${TARGET}
  MATCH (p:Person)-[w:WORKED_ON]->(x)
  RETURN ${PERSON}, 'workedOn' AS kind, 'changed ' + ${NAME} + ' ' + toString(w.count) + ' times' AS signal, w.count * 0.5 AS points
  UNION ALL
  ${TARGET}
  MATCH (p:Person)-[w:WORKED_ON]->(wi:WorkItem)-[:TOUCHES]->(x) WHERE ${shown("wi")}
  RETURN ${PERSON}, 'workedOn' AS kind, 'worked on "' + wi.title + '" ' + toString(w.count) + ' times' AS signal, w.count * 0.5 AS points
  UNION ALL
  ${TARGET}
  MATCH (d:Decision)-[:ABOUT|AFFECTS]->(x) WHERE d.status <> 'dismissed' AND ${visible("d")}
  MATCH (d)-[:MADE_BY]->(p:Person)
  WITH DISTINCT p, d
  RETURN ${PERSON}, 'decisions' AS kind, 'made "' + d.title + '"' AS signal, CASE d.status WHEN 'superseded' THEN 1.0 ELSE 3.0 END AS points
  UNION ALL
  ${TARGET}
  MATCH (d:Decision)-[:ABOUT|AFFECTS]->(x) WHERE d.status <> 'dismissed' AND ${visible("d")}
  MATCH (d)-[:APPROVED_BY]->(p:Person)
  WITH DISTINCT p, d
  RETURN ${PERSON}, 'decisions' AS kind, 'approved "' + d.title + '"' AS signal, 2.0 AS points
  UNION ALL
  ${TARGET}
  MATCH (d:Decision)-[:ABOUT|AFFECTS]->(x) WHERE d.status <> 'dismissed' AND ${visible("d")}
  MATCH (d)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)<-[:AUTHORED]-(p:Person) WHERE ${visible("s")}
  WITH DISTINCT p, s
  RETURN ${PERSON}, 'authored' AS kind, 'wrote ' + s.title AS signal, 2.0 AS points`;

export type SignalKind = "owns" | "decisions" | "authored" | "workedOn" | "centrality";

const CENTRALITY_POINTS = 3;

type Signal = {
  personId: string;
  name: string;
  title: string | null;
  onAxon: boolean;
  kind: SignalKind;
  signal: string;
  points: number;
};

export type RankedPerson = {
  personId: string;
  name: string;
  title: string | null;
  onAxon: boolean;
  score: number;
  breakdown: Record<SignalKind, number>;
  reasons: string[];
};

/** The top 5 people for a topic, scored from the signals the caller can see. Null when the topic has no searchable words. */
export async function rankPeople(ctx: BrainContext, topic: string): Promise<RankedPerson[] | null> {
  const { stems } = searchTerms(topic);
  if (stems.length === 0) return null;
  const signals = await readAsCaller<Signal>(ctx, SCORING, { stems });
  const centrality = signals.length > 0 ? await personCentrality(ctx).catch(logCentralityError) : null;

  const people = new Map<string, RankedPerson>();
  const seen = new Set<string>();
  for (const s of signals) {
    if (seen.has(`${s.personId} ${s.signal}`)) continue;
    seen.add(`${s.personId} ${s.signal}`);
    const person = people.get(s.personId) ?? {
      personId: s.personId,
      name: s.name,
      title: s.title,
      onAxon: s.onAxon,
      score: 0,
      breakdown: { owns: 0, decisions: 0, authored: 0, workedOn: 0, centrality: 0 },
      reasons: [],
    };
    person.score += s.points;
    person.breakdown[s.kind] += s.points;
    person.reasons.push(`${s.signal} (+${s.points})`);
    people.set(s.personId, person);
  }
  for (const person of people.values()) {
    const points = Math.round(CENTRALITY_POINTS * (centrality?.get(person.personId) ?? 0) * 10) / 10;
    if (points === 0) continue;
    person.score = Math.round((person.score + points) * 10) / 10;
    person.breakdown.centrality = points;
    person.reasons.push(`central among the people, decisions and sources you can see (+${points})`);
  }
  return [...people.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}

function logCentralityError(err: unknown): null {
  console.error("PageRank projection failed, ranking without it:", err);
  return null;
}

export type PersonItem = { id: string; kind: string; name: string; url: string | null };
export type WorkedOnItem = PersonItem & { count: number; via: string[] };
export type PersonDecision = { id: string; title: string; status: DecisionStatus; restricted: boolean; date: string; url: string | null };

export type PersonView = {
  id: string;
  name: string;
  title: string | null;
  role: Role | null;
  onAxon: boolean;
  owns: PersonItem[];
  workedOn: WorkedOnItem[];
  decisions: PersonDecision[];
};

const ITEM = "x.id AS id, labels(x) AS labels, coalesce(x.path, x.title, x.name) AS name, x.url AS url";
const KINDS = ["Project", "WorkItem", "CodeUnit", "Process"];

type ItemRow = { personId: string; id: string; labels: string[]; name: string; url: string | null };

function kindOf(labels: string[]): string {
  return KINDS.find((k) => labels.includes(k)) ?? labels[0];
}

/**
 * Members and the imported people the caller can see something for, with what they own, what they worked on most and
 * the decisions they made. Every item passes the same visibility checks as who_knows.
 */
export async function listPeople(ctx: BrainContext): Promise<PersonView[]> {
  const [people, owns, worked, decisions] = await Promise.all([
    readAsCaller<{ id: string; name: string; title: string | null; role: Role | null; onAxon: boolean }>(
      ctx,
      `${FROM_CALLER}
       MATCH (p:Person)
       OPTIONAL MATCH (p)-[:HAS_ROLE]->(r:Role)
       RETURN p.id AS id, p.name AS name, p.title AS title, r.name AS role, p.account_id IS NOT NULL AS onAxon
       ORDER BY p.name`,
    ),
    readAsCaller<ItemRow>(
      ctx,
      `${FROM_CALLER}
       MATCH (p:Person)-[:OWNS]->(x)
       WHERE x.deleted_at IS NULL AND ${shown("x")}
       RETURN DISTINCT p.id AS personId, ${ITEM}
       ORDER BY name`,
    ),
    readAsCaller<ItemRow & { count: number; via: string | null }>(
      ctx,
      `${FROM_CALLER}
       MATCH (p:Person)-[w:WORKED_ON]->(x)
       WHERE x.deleted_at IS NULL AND ${shown("x")}
       RETURN p.id AS personId, ${ITEM}, w.count AS count, null AS via
       UNION ALL
       ${FROM_CALLER}
       MATCH (p:Person)-[w:WORKED_ON]->(wi:WorkItem)-[:TOUCHES]->(x)
       WHERE wi.deleted_at IS NULL AND ${shown("wi")}
       RETURN p.id AS personId, ${ITEM}, w.count AS count, wi.title AS via`,
    ),
    readAsCaller<{ personId: string; id: string; title: string; status: DecisionStatus; sensitivity: string | null; at: unknown; urls: string[] }>(
      ctx,
      `${FROM_CALLER}
       MATCH (d:Decision)-[:MADE_BY]->(p:Person)
       WHERE d.status <> 'dismissed' AND ${visible("d")}
       OPTIONAL MATCH (d)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)
       WHERE s.url IS NOT NULL AND ${visible("s")}
       RETURN p.id AS personId, d.id AS id, d.title AS title, d.status AS status, d.sensitivity AS sensitivity,
              coalesce(d.valid_from, d.recorded_at) AS at, collect(s.url) AS urls
       ORDER BY at DESC, id`,
    ),
  ]);

  const views = new Map<string, PersonView>(
    people.map((p) => [p.id, { ...p, owns: [], workedOn: [], decisions: [] }]),
  );
  for (const row of owns) {
    views.get(row.personId)?.owns.push({ id: row.id, kind: kindOf(row.labels), name: row.name, url: row.url });
  }
  for (const row of worked) {
    const person = views.get(row.personId);
    if (!person) continue;
    let item = person.workedOn.find((i) => i.id === row.id);
    if (!item) {
      item = { id: row.id, kind: kindOf(row.labels), name: row.name, url: row.url, count: 0, via: [] };
      person.workedOn.push(item);
    }
    item.count += row.count;
    if (row.via) item.via.push(row.via);
  }
  for (const row of decisions) {
    views.get(row.personId)?.decisions.push({
      id: row.id,
      title: row.title,
      status: row.status,
      restricted: row.sensitivity === "restricted",
      date: day(row.at),
      url: row.urls[0] ?? null,
    });
  }

  return [...views.values()]
    .map((p) => ({ ...p, workedOn: p.workedOn.sort((a, b) => b.count - a.count) }))
    .filter((p) => p.role !== null || p.owns.length + p.workedOn.length + p.decisions.length > 0);
}
