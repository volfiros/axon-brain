# Ontology

Axon uses a small fixed core that the agent reasons over, plus workspace types each team customizes. FalkorDB nodes can carry several labels, so a node can be `(:WorkItem:Issue)`: the agent queries `:WorkItem` and the UI shows "Issue".

## Core node types

**Organization**
- `Person`, `Team`, `Role`

**Work**
- `Project`: a long-running effort
- `WorkItem`: ticket, issue or task
- `CodeUnit`: repository, service, module or file
- `Process`: how something gets done, such as a refund flow or onboarding

**Knowledge**
- `Decision`: a choice the team made
- `Constraint`: a fact that limits choices (budget, team size, compliance, a vendor limit)
- `Assumption`: believed true but not verified
- `Alternative`: an option considered and rejected
- `Topic`: a free concept such as pricing or auth

**Sources**
- `Source`, with subtypes `Message`, `Thread`, `Doc`, `PR`, `Commit`, `Meeting`, `Conversation`
- `Excerpt`: the exact quote a fact was extracted from

**Outside world**
- `ExternalParty`: customer, seller, vendor or investor
- `Feedback`: a request, complaint or bug report

## Relationships

### Decisions

```
(Decision)-[:MADE_BY]->(Person)
(Decision)-[:APPROVED_BY]->(Person)
(Decision)-[:ABOUT]->(Topic | Project | Process)
(Decision)-[:AFFECTS]->(CodeUnit | Process | WorkItem)
(Decision)-[:BECAUSE_OF]->(Constraint | Assumption | Feedback)
(Decision)-[:CONSIDERED]->(Alternative)
(Decision)-[:SUPERSEDES]->(Decision)
(Decision)-[:IMPLEMENTED_BY]->(PR | Commit)
(Decision)-[:DERIVED_FROM]->(Excerpt)-[:IN]->(Source)
(Constraint | Assumption)-[:DERIVED_FROM]->(Excerpt)
(Source)-[:ABOUT]->(Topic | Project | Process | CodeUnit)
```

A context note (something worth keeping that is not a decision, constraint or assumption) is a `Source:Conversation` with a `summary`, its `Excerpt`, and `ABOUT` edges to what it concerns.

### Ownership and expertise

```
(Person)-[:MEMBER_OF]->(Team)
(Person)-[:OWNS]->(CodeUnit | Process | Project)
(Person)-[:AUTHORED]->(Source)
(Person)-[:WORKED_ON {count, last_at}]->(CodeUnit | WorkItem)
```

### Work and feedback

```
(WorkItem)-[:PART_OF]->(Project)
(WorkItem)-[:TOUCHES]->(CodeUnit)
(Feedback)-[:FROM]->(ExternalParty)
(Feedback)-[:REQUESTS | REPORTS]->(Topic | Process)
(WorkItem)-[:RESOLVES]->(Feedback)
```

## Constraints and assumptions are nodes

Reasons are shared nodes, not text fields. When a constraint changes, Axon finds every decision that depended on it:

```cypher
MATCH (c:Constraint {id: $id})<-[:BECAUSE_OF]-(d:Decision {status: 'accepted'})
OPTIONAL MATCH (d)-[:AFFECTS]->(x)
RETURN d.title, collect(x.name) AS affects
```

## Time

- Decisions and fact edges carry `valid_from`, `valid_to` and `recorded_at`.
- Nothing is deleted. A new decision `SUPERSEDES` the old one, which gets a `valid_to`.
- Queries default to current facts and can ask what was true at a past date.
- A decision is flagged stale when the code it affects has changed a lot since it was made.

## Provenance

Every extracted node or edge carries `confidence`, `extracted_by` and, once approved, `confirmed_by`. Confirmed facts rank above extracted ones.

## Access control

```
(Person)-[:HAS_ROLE]->(Role)
(Source | Decision | Constraint | Assumption)-[:VISIBLE_TO]->(Team | Role | Person)
sensitivity: 'public' | 'team' | 'restricted'
```

- `public` is visible to Admin, Member and Guest. `team` is visible to Admin and Member. `restricted` is visible to Admin, or to the specific Team or Person it names.
- Visibility is inherited from the source. A decision extracted from a restricted thread is restricted by default.
- Every retrieval starts from the user and only follows visible nodes.
- One FalkorDB graph per workspace for isolation between companies.
- A Person points to its Account with `account_id`. Accounts live in the shared accounts graph (ADR 0001). A Person seen only in imported data has no `account_id`.

Every agent read starts from the caller and checks visibility with a pattern predicate in `WHERE` (`lib/brain/access.ts`). Pattern predicates only work in `WHERE` in FalkorDB, not in `RETURN`.

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (d:Decision)-[:AFFECTS]->(:CodeUnit {path: $path})
WHERE d.status = 'accepted'
  AND ((d)-[:VISIBLE_TO]->(u) OR (d)-[:VISIBLE_TO]->(role) OR (d)-[:VISIBLE_TO]->(:Team)<-[:MEMBER_OF]-(u))
RETURN d
```

- Nodes without their own visibility (Topic, CodeUnit, Alternative, Feedback, Person) are only shown when reached through a visible node. An Excerpt is visible when its Source is.
- When matches exist that the caller cannot see, a second query with `NOT <visible>` returns only a count. The agent answers "there is a restricted decision on this, ask <Admin>" without content.

## Graphs and indexes

- Accounts graph: `<prefix>_accounts`. Workspace graphs: `<prefix>_<slug>`, where the slug is the same one used in `/w/<slug>/mcp` (lowercase letters, digits and hyphens).
- Every core node has a string `id`. Each Workspace graph gets these indexes when it is created (`ensureWorkspaceSchema` in `lib/graph/schema.ts`):

| Kind | Indexed |
| --- | --- |
| Range | `id` on every core label, `Person.account_id`, `CodeUnit.path`, `Decision.status` |
| Full-text | `Decision(title, statement)`, `Excerpt(text)` |
| Vector | `Decision.embedding`, cosine, only when `EMBEDDING_DIMENSION` is set |

```cypher
CALL db.idx.fulltext.queryNodes('Decision', 'refund*') YIELD node, score
RETURN node.title, score
```

## Customization

The workspace schema lives in the graph:

```
(:TypeDef {name: 'Seller', core: 'ExternalParty', extraction_hint: '...'})
(:RelDef {name: 'LISTS_IN', from: 'Seller', to: 'Market'})
```

Teams start from a template and rename or add types. Every custom type maps to a core type, so agent tools, Guard, access control and ranking keep working.

| Template | Example custom types |
| --- | --- |
| B2B SaaS | Account, Deal, Feature, Incident |
| Marketplace | Seller, Buyer, Market, Listing, SupportChat |
| Agency | Client, Engagement, Deliverable |
| Dev tools / OSS | Contributor, Release, RFC |

## Retrieval

1. Find entry points with vector and full-text search over nodes.
2. Expand 1 to 3 hops along typed edges, filtering by access and validity at each step.
3. Rank: confirmed over extracted, current over superseded, closer over farther.
4. Answer with the path and sources.

## Agent tools (brain MCP server)

The brain MCP server lives at `/w/<workspace>/mcp` (ADR 0003). The workspace comes only from the URL. Reads use `roQuery`; `save` and `supersede` write through `lib/brain/write.ts`.

| Tool | Purpose |
| --- | --- |
| `whoami` | The caller's Person, Role, Teams and Workspace |
| `recall(question)` | Answer with Decision and status, Because, Rejected, Decided by and date, Source quote and link, graph Path |
| `save(item, confirm)` | Preview a Decision, Constraint, Assumption or context note; writes only with `confirm: true` |
| `supersede(old_id, item, confirm)` | Replace a decision and keep the old one as history |
| `who_knows(topic)` | People ranked by a scoring query over ownership, decisions, sources and changes |
| `impact(constraint)` | Current decisions that rely on a constraint or assumption (`BECAUSE_OF`) |
| `pending_sources` | Connector Sources still waiting for extraction, paged, text capped at 4,000 characters per call |
| `propose_from_source(source_id, content_hash, items)` | Write the decisions found in one Source as `proposed`, then mark the Source done |
| `review_proposals(action)` | List proposed decisions, or accept (optionally edited) or dismiss them |

Planned, not built yet: `what_changed(since, person)` for My Brief.

- A Decision saved through the agent is `accepted` with `confirmed_by` set to the caller, because the person who made it confirmed the preview. Decisions extracted from connector Sources are `proposed` until a person accepts them.
- Decision status is one of `proposed`, `accepted`, `superseded` or `dismissed`. Dismissed decisions are kept (with `dismissed_by` and `dismissed_at`) but recall, who_knows and impact skip them.
- `sensitivity` defaults to `team`. A superseding decision inherits the old one's sensitivity. `restricted` items are also `VISIBLE_TO` their author.
- Guests can read but not save, extract or review.

### Extraction from connector Sources

Connectors write Sources with `extraction` set to `'pending'`, `'done'` or `'skipped'`, plus `text` and `content_hash` (sha256 of title and text). A changed hash puts a Source back to `'pending'`. The agent then:

1. Calls `pending_sources` (visible, `extraction = 'pending'`, `deleted_at IS NULL`, oldest first).
2. Calls `recall` on each decision it finds and leaves out ones already saved.
3. Calls `propose_from_source` with the Source's `content_hash`. Each excerpt must appear word for word in the Source text (whitespace collapsed), or nothing is written. A changed hash also writes nothing.
4. Asks the person, then calls `review_proposals` to accept or dismiss.

A proposed Decision is `DERIVED_FROM` an Excerpt `IN` the Source, `MADE_BY` the Source's author when there is exactly one, copies the Source's `VISIBLE_TO` edges, and stores `source_hash`. The Source gets `extraction = 'done'`, `extracted_at` and `extracted_by`. If the Source text later changes, `source_hash` no longer matches and the review list says so.

```cypher
MATCH (s:Source {id: $id}) WHERE s.content_hash = $hash
SET s.extraction = 'done', s.extracted_at = localdatetime(), s.extracted_by = $personId
```

### Recall

Three entry points, each filtered by visibility and skipping dismissed decisions, then expanded to reasons, alternatives, sources and history. Ranking: superseded last, then by how many question words appear in the decision's title and statement, then accepted before proposed, then by full-text score. FalkorDB full-text scores vary too much between nodes to rank on alone.

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
CALL db.idx.fulltext.queryNodes('Decision', $q) YIELD node AS d, score
WITH u, role, d, score
WHERE <visible(d)>
RETURN d.id, d.status, score
UNION ALL
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
CALL db.idx.fulltext.queryNodes('Excerpt', $q) YIELD node AS ex, score
MATCH (d:Decision)-[:DERIVED_FROM]->(ex)
WITH u, role, d, score
WHERE <visible(d)>
RETURN d.id, d.status, score
UNION ALL
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (x) WHERE (x:Topic OR x:CodeUnit OR x:Process OR x:Project)
  AND any(w IN $stems WHERE toLower(x.name) CONTAINS w OR toLower(coalesce(x.path, '')) CONTAINS w)
MATCH (d:Decision)-[:ABOUT|AFFECTS]->(x)
WITH u, role, d, 1.0 AS score
WHERE <visible(d)>
RETURN d.id, d.status, score
```

Reasons are filtered too: `OPTIONAL MATCH (d)-[:BECAUSE_OF]->(r) WHERE r:Feedback OR <visible(r)>`, and hidden reasons are only counted.

### Who knows

One `UNION ALL` query returns one row per signal, summed per person. Points: owns the topic, file or process 5; made a current decision on it 3 (a superseded one 1); approved one 2; wrote a source behind one 2; 0.5 per recorded change (`WORKED_ON.count`, directly or through a WorkItem that `TOUCHES` it). Only decisions and sources visible to the caller score.

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (x) WHERE (x:Topic OR x:CodeUnit OR x:Process OR x:Project)
  AND any(w IN $stems WHERE toLower(x.name) CONTAINS w OR toLower(coalesce(x.path, '')) CONTAINS w)
MATCH (d:Decision)-[:ABOUT|AFFECTS]->(x) WHERE <visible(d)>
MATCH (d)-[:MADE_BY]->(p:Person)
WITH DISTINCT p, d
RETURN p.name, 'made "' + d.title + '"' AS signal, CASE d.status WHEN 'superseded' THEN 1.0 ELSE 3.0 END AS points
UNION ALL
...
```

### Impact

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (c {id: $id})<-[:BECAUSE_OF]-(d:Decision)
WHERE d.status <> 'superseded' AND <visible(d)>
OPTIONAL MATCH (d)-[:MADE_BY]->(maker:Person)
OPTIONAL MATCH (d)-[:AFFECTS]->(x)
OPTIONAL MATCH (x)<-[:OWNS]-(owner:Person)
RETURN d.title, maker.name, collect(DISTINCT coalesce(x.path, x.name)) AS affects, collect(DISTINCT owner.name) AS owners
```

### Supersede

```cypher
MATCH (new:Decision {id: $newId}), (old:Decision {id: $oldId})
CREATE (new)-[:SUPERSEDES]->(old)
SET old.status = 'superseded', old.valid_to = localdatetime()
```
