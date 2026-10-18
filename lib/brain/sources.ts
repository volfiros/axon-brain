import { FROM_CALLER, readAsCaller, visible } from "./access";
import { searchTerms } from "./search";
import type { BrainContext } from "./tool";

export type FoundSource = {
  id: string;
  externalId: string;
  kind: string;
  title: string;
  url: string | null;
  at: unknown;
  text: string;
  authors: string[];
  attendees: string[];
  parent: string | null;
  /** A PR's reviews and comments, with who wrote them. */
  reviews: string[];
  /** The search hit this message was pulled in for, when it came from the conversation around one. */
  near: string | null;
};

export type SearchOptions = {
  limit?: number;
  /** How many hits get their conversation added. */
  expand?: number;
  /** Messages added around each expanded hit. */
  around?: number;
  /** Hours before and after a hit that still count as the same conversation. */
  windowHours?: number;
  /** Full-text candidates re-ranked by term coverage. */
  pool?: number;
  /** Direct hits listed before any conversation is added. */
  direct?: number;
};

type Hit = { id: string; channel: string | null; at: string };

const shift = (at: string, hours: number) => new Date(Date.parse(`${at}Z`) + hours * 3_600_000).toISOString().slice(0, 19);

/** Full-text search over Sources the caller can see, plus Sources ABOUT a Topic the query names. Top hits bring the Sources they reference or are referenced by, then the messages around them in their channel. */
export async function searchSources(ctx: BrainContext, query: string, options: SearchOptions = {}): Promise<FoundSource[] | null> {
  const { limit = 10, expand = 5, around = 4, windowHours = 6, pool = 2000 } = options;
  const direct = options.direct ?? limit;
  const { fulltext } = searchTerms(query);
  if (!fulltext) return null;

  const { stems } = searchTerms(query);
  // Full-text scores favour short texts that repeat one term, so a wide pool is re-ranked by the query terms each candidate covers.
  const candidates = await readAsCaller<Hit & { score: number; text: string }>(
    ctx,
    `${FROM_CALLER}
     CALL db.idx.fulltext.queryNodes('Source', $q) YIELD node AS s, score
     WITH u, role, s, score
     WHERE s.deleted_at IS NULL AND ${visible("s")}
     RETURN s.id AS id, s.channel AS channel, toString(s.created_at) AS at, score, toLower(s.title + ' ' + s.text) AS text
     ORDER BY score DESC LIMIT $pool`,
    { q: fulltext, pool },
  );
  // Rare terms say more about a question than common ones, so each covered term counts by how few candidates contain it.
  const weight = new Map(stems.map((w) => [w, Math.log((candidates.length + 1) / (candidates.filter((c) => c.text.includes(w)).length + 1))]));
  const coverage = (text: string) => stems.reduce((sum, w) => sum + (text.includes(w) ? weight.get(w)! : 0), 0);
  const hits = candidates
    .map((c) => ({ ...c, coverage: coverage(c.text) }))
    .sort((a, b) => b.coverage - a.coverage || b.score - a.score || b.at.localeCompare(a.at))
    .slice(0, direct);

  // A Source linked to a Topic is found by the topic's words even when its own text uses different ones.
  const topical = await readAsCaller<{ topic: string; name: string; id: string }>(
    ctx,
    `${FROM_CALLER}
     MATCH (t:Topic)<-[:ABOUT]-(s:Source)
     WHERE any(w IN $stems WHERE toLower(t.name) CONTAINS w) AND s.deleted_at IS NULL AND ${visible("s")}
     RETURN t.id AS topic, toLower(t.name) AS name, s.id AS id`,
    { stems },
  );
  const topics = [...new Map(topical.map((t) => [t.topic, t.name])).entries()]
    .map(([topic, name]) => {
      const words = searchTerms(name).stems;
      const covered = words.filter((w) => stems.includes(w)).length;
      return { topic, covered, share: covered / words.length, coverage: coverage(name) };
    })
    // A topic counts only when the query names most of it, so a shared word or two does not pull in its whole list.
    .filter((t) => t.covered >= 2 && t.share >= 0.6)
    .sort((a, b) => b.coverage - a.coverage)
    .slice(0, 2);

  const anchors = hits.slice(0, expand).filter((h) => h.channel);
  const neighbours = anchors.length
    ? await readAsCaller<{ hit: string; id: string; at: string }>(
        ctx,
        `${FROM_CALLER}
         UNWIND $anchors AS h
         MATCH (s:Source {channel: h.channel})
         WHERE s.id <> h.id AND s.deleted_at IS NULL AND s.created_at >= localdatetime(h.from) AND s.created_at <= localdatetime(h.to)
           AND ${visible("s")}
         RETURN h.id AS hit, s.id AS id, toString(s.created_at) AS at`,
        { anchors: anchors.map((h) => ({ ...h, from: shift(h.at, -windowHours), to: shift(h.at, windowHours) })) },
      )
    : [];

  const referenced = hits.length
    ? await readAsCaller<{ hit: string; id: string }>(
        ctx,
        `${FROM_CALLER}
         UNWIND $ids AS hid
         MATCH (h:Source {id: hid})-[:REFERENCES]-(s:Source)
         WHERE s.deleted_at IS NULL AND ${visible("s")}
         RETURN hid AS hit, s.id AS id`,
        { ids: hits.slice(0, expand).map((h) => h.id) },
      )
    : [];

  const order: { id: string; near: string | null }[] = [];
  const seen = new Set<string>();
  const push = (id: string, near: string | null) => {
    if (!seen.has(id)) order.push({ id, near }), seen.add(id);
  };
  for (const hit of hits) push(hit.id, null);
  for (const t of topics) for (const s of topical.filter((s) => s.topic === t.topic)) push(s.id, null);
  for (const hit of hits) for (const r of referenced.filter((r) => r.hit === hit.id)) push(r.id, hit.id);
  for (const hit of hits) {
    const gap = (at: string) => Math.abs(Date.parse(`${at}Z`) - Date.parse(`${hit.at}Z`));
    neighbours
      .filter((n) => n.hit === hit.id)
      .sort((a, b) => gap(a.at) - gap(b.at))
      .slice(0, around)
      .forEach((n) => push(n.id, hit.id));
  }
  const ids = order.slice(0, limit).map((o) => o.id);
  if (ids.length === 0) return [];

  const rows = await readAsCaller<Omit<FoundSource, "near">>(
    ctx,
    `${FROM_CALLER}
     UNWIND $ids AS sid
     MATCH (s:Source {id: sid})
     OPTIONAL MATCH (a:Person)-[:AUTHORED]->(s)
     WITH u, role, s, collect(DISTINCT a.name) AS authors
     OPTIONAL MATCH (m:Person)-[:ATTENDED]->(s)
     WITH u, role, s, authors, collect(DISTINCT m.name) AS attendees
     OPTIONAL MATCH (s)-[:PART_OF]->(p:Source) WHERE ${visible("p")}
     WITH u, role, s, authors, attendees, head(collect(p.title)) AS parent
     OPTIONAL MATCH (r:Message)-[:PART_OF]->(s:PR) WHERE ${visible("r")}
     OPTIONAL MATCH (ra:Person)-[:AUTHORED]->(r)
     RETURN s.id AS id, s.external_id AS externalId, [l IN labels(s) WHERE l <> 'Source'][0] AS kind, s.title AS title,
            s.url AS url, s.created_at AS at, s.text AS text, authors, attendees, parent,
            [x IN collect(DISTINCT CASE WHEN r IS NULL THEN null ELSE left(r.text, 120) + coalesce(' (' + ra.name + ')', '') END) WHERE x IS NOT NULL] AS reviews`,
    { ids },
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return order
    .slice(0, limit)
    .filter((o) => byId.has(o.id))
    .map((o) => ({ ...byId.get(o.id)!, near: o.near }));
}
