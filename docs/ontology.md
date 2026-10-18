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
(Person)-[:OWNS]->(CodeUnit | Process | Project | WorkItem)
(Person)-[:AUTHORED]->(Source)
(Person)-[:WORKED_ON {count, last_at}]->(CodeUnit | WorkItem)
```

### Work and feedback

```
(WorkItem)-[:PART_OF]->(Project)
(WorkItem | PR | Commit | Message)-[:TOUCHES]->(CodeUnit)
(CodeUnit {kind: 'file'})-[:PART_OF]->(CodeUnit {kind: 'repository'})
(Message)-[:PART_OF]->(PR | Message | WorkItem)
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
- An accepted decision is stale when 3 or more PRs or commits the caller can see touched the code it `AFFECTS` after it was made (see Stale decisions).

## Provenance

Every extracted node or edge carries `confidence`, `extracted_by` and, once approved, `confirmed_by`. Confirmed facts rank above extracted ones.

## Access control

```
(Person)-[:HAS_ROLE]->(Role)
(Source | Project | Decision | Constraint | Assumption)-[:VISIBLE_TO]->(Team | Role | Person)
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

## Accounts graph

The shared `<prefix>_accounts` graph holds sign-in identity and the index of Workspaces (ADR 0001).

```
(Account)-[:JOINED {at}]->(Workspace)
(Invite)-[:FOR]->(Workspace)
(Connector)-[:FOR]->(Workspace)
```

- `Workspace {id, slug, name, created_at}`: `slug` is stable and names the Workspace graph and its `/w/<slug>/mcp` address.
- `Connector {id: 'github:<installation_id>', provider: 'github', installation_id, repo, status, synced_at}`: links a GitHub App installation to the Workspace whose graph its webhooks write to. `status` is `syncing`, `synced`, `error` or `disconnected`.
- `Invite {code, role, created_at, expires_at}`: one live invite per Role per Workspace, valid for 7 days. `role` is `Member` or `Guest`, never `Admin`, and joining adds a Person with that Role. An Invite without `role`, made before roles were added, joins as Guest.
- `Account {id, name, email, username, ...}` and the other sign-in nodes are written by Better Auth through the FalkorDB adapter (`lib/auth/falkordb-adapter.ts`). Each Better Auth model is one label with flat properties, linked by id properties rather than edges: `Credential` (password hash), `Session`, `Verification`, `Jwks`, and the OAuth provider's `OauthClient`, `OauthAccessToken`, `OauthRefreshToken`, `OauthConsent` and `OauthResource`. Dates are ISO strings.
- Each Workspace registers an `OauthResource` with `identifier` set to its MCP address. Access tokens carry that address as their audience, so a token works for one Workspace only (ADR 0004).

In each Workspace graph, a signed-in member is `(Person {id, name, handle, account_id})-[:HAS_ROLE]->(Role {id, name})`, where `handle` is the Account username and the Roles are `role_admin`, `role_member` and `role_guest`. The creator of a Workspace is its first Admin.

Resolving an MCP caller (`resolveCaller` in `lib/auth/caller.ts`) verifies the token, then reads the Person and Role through `GRAPH.RO_QUERY`:

```cypher
MATCH (p:Person {account_id: $accountId})-[:HAS_ROLE]->(r:Role)
RETURN p.id AS personId, r.name AS role
```

Changing a Role checks the Admin and keeps at least one Admin inside the same query:

```cypher
MATCH (:Person {account_id: $adminAccountId})-[:HAS_ROLE]->(:Role {name: 'Admin'})
MATCH (p:Person {id: $personId})-[current:HAS_ROLE]->(from:Role)
MATCH (to:Role {name: $role})
OPTIONAL MATCH (other:Person)-[:HAS_ROLE]->(:Role {name: 'Admin'})
WHERE other <> p
WITH p, current, from, to, count(other) AS otherAdmins
WHERE from.name <> 'Admin' OR to.name = 'Admin' OR otherAdmins > 0
DELETE current
CREATE (p)-[:HAS_ROLE]->(to)
```

Removing a member or leaving runs the same guards in one query, then deletes the `JOINED` edge in the accounts graph. Only `HAS_ROLE` is deleted: the Person keeps its `account_id`, so `MADE_BY` and `AUTHORED` keep their history and a later rejoin finds the same Person as a Guest. Without a Role the Person fails every `FROM_CALLER` match, so MCP tokens stop working at once.

```cypher
MATCH (:Person {account_id: $adminAccountId})-[:HAS_ROLE]->(:Role {name: 'Admin'})
MATCH (p:Person {id: $personId})-[current:HAS_ROLE]->(r:Role)
OPTIONAL MATCH (other:Person)-[:HAS_ROLE]->(:Role {name: 'Admin'})
WHERE other <> p
WITH p, current, r, count(other) AS otherAdmins
WHERE r.name <> 'Admin' OR otherAdmins > 0
DELETE current
```

Leaving matches the caller's own Person by `account_id` instead of the Admin line. Revoking an invite deletes the `Invite` node after an Admin check in application code, because the Invite and the Role live in different graphs.

The workspace home lists Decisions through the same `FROM_CALLER` and `visible(d)` filter as recall, then loads details with recall's detail query. It shows only visible rows and no workspace-wide hidden count; inside a decision, hidden reasons and sources get the same "restricted, ask <Admin>" note recall gives.

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (d:Decision) WHERE d.status IN $statuses AND <visible(d)>
OPTIONAL MATCH (d)-[:AFFECTS]->(x)
WITH d, collect(DISTINCT coalesce(x.path, x.name)) AS affects
RETURN d.id, d.sensitivity, affects
ORDER BY coalesce(d.valid_from, d.recorded_at) DESC
```

The Graph page (`lib/brain/graph-view.ts`) draws what the caller can see. Decisions, Sources, Constraints and Assumptions pass `visible(n)`; Persons, Topics and CodeUnits appear only next to one of those; Excerpts only when their Source is visible. Dismissed Decisions and deleted Sources are left out. The page keeps at most 300 nodes, Decisions first, and says when it cut some. Edges are then read only between the ids that passed, without `VISIBLE_TO`.

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (a)-[r]-(n)
WHERE (a:Decision OR a:Source OR a:Constraint OR a:Assumption) AND <visible(a)>
  AND (n:Person OR n:Topic OR n:CodeUnit) AND type(r) <> 'VISIBLE_TO'
RETURN DISTINCT n
```

Selecting a Decision highlights the same directed shortest paths recall prints (`decisionPaths`: Decision to one visible Source through its Excerpt, and Decision to its maker), returned as node ids.

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

The brain MCP server lives at `/w/<workspace>/mcp` (ADR 0003). The workspace comes only from the URL. Reads use `roQuery`; `save` and `supersede` write through `lib/brain/write.ts`. The one write a read tool makes is the temporary PageRank projection in `who_knows`, which lives in its own graph and is always deleted.

| Tool | Purpose |
| --- | --- |
| `whoami` | The caller's Person, Role, Teams and Workspace |
| `recall(question)` | Answer with Decision and status, Because, Rejected, Decided by and date, Source quote and link, graph Path |
| `save(item, confirm)` | Preview a Decision, Constraint, Assumption or context note; writes only with `confirm: true` |
| `save_session(step, session, items)` | Preview, then save a coding session's distilled decisions, constraints, assumptions, questions and notes (see Session capture) |
| `supersede(old_id, item, confirm)` | Replace a decision and keep the old one as history |
| `who_knows(topic)` | People ranked by a scoring query over ownership, decisions, sources and changes, plus PageRank over the caller's visible graph |
| `impact(constraint)` | Current decisions that rely on a constraint or assumption (`BECAUSE_OF`) |
| `pending_sources` | Connector Sources still waiting for extraction, paged, text capped at 4,000 characters per call |
| `propose_from_source(source_id, content_hash, items)` | Write the decisions found in one Source as `proposed`, then mark the Source done |
| `review_proposals(action)` | List proposed decisions, or accept (optionally edited) or dismiss them |
| `review_source_changes(action, ids)` | List accepted decisions whose Source was edited or deleted since it was recorded, and possible conflicts ranked by source, or confirm that they still hold |
| `changes_since(since, until)` | Decisions created, superseded or flagged, proposals accepted, and Sources edited or deleted in a time window, paged |
| `check_answer(statements)` | For each statement of an answer, whether the decisions it cites are current, superseded, flagged, not accepted, or not found or not visible |
| `save_answer(question, statements, confirm)` | Preview, then save an answer whose statements each cite accepted decisions (see Saved answers) |
| `answer_status(stale_only)` | Saved answers the caller can see, stale first, with why and the replacing decision |
| `stale_decisions` | Accepted decisions whose code changed 3+ times since, with the changes and code owners |
| `graph_algorithm(algorithm, from, to)` | `betweenness`, `components` or `shortest_path` over the caller's visible graph |

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

A proposed Decision is `DERIVED_FROM` an Excerpt `IN` the Source, with `source_hash` on that link, `MADE_BY` the Source's author when there is exactly one, and copies the Source's `VISIBLE_TO` edges. The Source gets `extraction = 'done'`, `extracted_at` and `extracted_by`. If the Source text later changes, `source_hash` no longer matches and the review list says so. Accepting keeps the hash from the proposal, and only fills in links that have none.

```cypher
MATCH (s:Source {id: $id}) WHERE s.content_hash = $hash
SET s.extraction = 'done', s.extracted_at = localdatetime(), s.extracted_by = $personId
```

### Source changes

Connectors update `content_hash` when a message or work item is edited and set `deleted_at` when it is deleted. An accepted Decision needs review when one of its visible Sources changed since the link was stamped. Recall adds a line per changed Source, the workspace home shows a "Source changed" badge, and `review_source_changes list` lists them. Decision status never changes on its own: a person confirms the decision still holds (`review_source_changes still_holds`, or "Still holds" in the side sheet), which re-stamps the link, or supersedes it. Only Sources the caller can see are checked, so a hidden Source shows up only as the usual restricted note.

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (d:Decision {status: 'accepted'})-[link:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)
WHERE <visible(d)> AND <visible(s)>
  AND ((s.deleted_at IS NOT NULL AND (link.checked_at IS NULL OR link.checked_at < s.deleted_at))
    OR (s.deleted_at IS NULL AND link.source_hash IS NOT NULL AND s.content_hash <> link.source_hash))
RETURN DISTINCT d.id, d.title
```

Still holds, through application code only:

```cypher
SET link.source_hash = s.content_hash, link.checked_at = localdatetime(), link.checked_by = $personId
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

The Path line comes from two directed `shortestPath` calls per decision: one to a visible Source (the first by id) and one to the decision's maker. Both endpoints pass the visibility filter before the path is computed, and the only node between a decision and its source is the Excerpt, which is visible when its Source is, so no restricted node appears in a path. FalkorDB only allows `shortestPath` in `WITH` or `RETURN`, so a missing endpoint is guarded with `CASE`.

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (d:Decision) WHERE d.id IN $ids AND <visible(d)>
OPTIONAL MATCH (d)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source) WHERE <visible(s)>
WITH d, s ORDER BY s.id
WITH d, collect(s)[0] AS s
OPTIONAL MATCH (d)-[:MADE_BY]->(p:Person)
WITH d, s, p,
     CASE WHEN s IS NULL THEN null ELSE shortestPath((d)-[:DERIVED_FROM|IN*..2]->(s)) END AS toSource,
     CASE WHEN p IS NULL THEN null ELSE shortestPath((d)-[:MADE_BY]->(p)) END AS toMaker
RETURN d.id, nodes(toSource), relationships(toSource), nodes(toMaker), relationships(toMaker)
```

The agent sees, for example, `Path: (CodeUnit: src/webhooks.ts)<-[:AFFECTS]-(Decision: Handle webhooks idempotently by event id)-[:DERIVED_FROM]->(Excerpt)-[:IN]->(PR: ...); (Decision: ...)-[:MADE_BY]->(Person: ...)`.

### Who knows

One `UNION ALL` query returns one row per signal, summed per person. Points: owns the topic, file or process 5; made a current decision on it 3 (a superseded one 1); approved one 2; wrote a source behind one 2; 0.5 per recorded change (`WORKED_ON.count`, directly or through a WorkItem that `TOUCHES` it). Only decisions and sources visible to the caller score. A matched node or WorkItem that has `VISIBLE_TO` edges (a Project or Plane work item) must be visible to the caller too; nodes without any (CodeUnit, Process, Topic) always count.

Each row also carries a `kind` (`owns`, `decisions`, `authored`, `workedOn`) so the People view can split the score. The query and the summing live in `rankPeople` (`lib/brain/people.ts`), which both the `who_knows` tool and the People page call.

```cypher
-- shown(x): NOT (x)-[:VISIBLE_TO]->() OR <visible(x)>
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (x) WHERE (x:Topic OR x:CodeUnit OR x:Process OR x:Project)
  AND any(w IN $stems WHERE toLower(x.name) CONTAINS w OR toLower(coalesce(x.path, '')) CONTAINS w)
  AND <shown(x)>
MATCH (p:Person)-[w:WORKED_ON]->(wi:WorkItem)-[:TOUCHES]->(x) WHERE <shown(wi)>
RETURN p.name, 'workedOn' AS kind, 'worked on "' + wi.title + '"' AS signal, w.count * 0.5 AS points
```

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

#### Centrality (PageRank on a temporary projection)

`algo.pageRank` runs over a whole label and relationship type, so on the workspace graph it would count decisions the caller cannot see. `personCentrality` (`lib/brain/centrality.ts`) instead copies only what the caller can see into a new graph `<graph>__algo_<uuid>` (`withScratchGraph` in `lib/graph/client.ts`), runs PageRank there and deletes the graph in a `finally`, even when the algorithm fails.

- Nodes: every Person, the Decisions the caller can see (not dismissed) and the Sources the caller can see (not deleted), all copied as `(:N {key})` with keys `person:<id>`, `decision:<id>` and `source:<id>`.
- Edges: Decision `MADE_BY` or `APPROVED_BY` Person, Person `AUTHORED` Source, and Decision `DERIVED_FROM` an Excerpt `IN` a Source (collapsed into one edge). Each becomes `[:R]` in both directions.
- With no edges, over 3,000 nodes or 20,000 edges, or when the projection fails, who_knows ranks without it.
- Each Person's score is divided by the highest Person score. A person who already has a topic signal gets `3 × that ratio` extra points, kind `centrality`, rounded to one decimal. PageRank never adds someone with no signal on the topic, so it reorders the list without filling it.
- The People view shows these points in a Centrality column.

```cypher
-- in the scratch graph, after copying the caller's visible rows
CALL algo.pageRank('N', 'R') YIELD node, score
WHERE node.key STARTS WITH 'person:'
RETURN node.key, score
```

### Stale decisions

`staleDecisions` (`lib/brain/stale.ts`) backs the `stale_decisions` tool and the Stale badge on the decisions page. The decision's own source and `IMPLEMENTED_BY` PRs do not count.

```cypher
MATCH (d:Decision {status: 'accepted'})-[:AFFECTS]->(c:CodeUnit)<-[:TOUCHES]-(s:Source)
WHERE (s:PR OR s:Commit) AND s.deleted_at IS NULL
  AND s.created_at > coalesce(d.valid_from, d.recorded_at)
  AND NOT (d)-[:IMPLEMENTED_BY]->(s) AND NOT (d)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s)
  AND <visible(d)> AND <visible(s)>
RETURN d.id, s.id, s.created_at, c.path
-- grouped per decision; stale at 3 or more distinct s
```

### Graph algorithms

`graph_algorithm` copies what the caller can see into a scratch graph (`withVisibleProjection` in `lib/brain/projection.ts`, same rules as PageRank above) and runs one FalkorDB algorithm there.

- Nodes: Persons, visible Decisions and Sources, and CodeUnits linked to them, as `(:N {key, kind, name})`.
- Edges: the PageRank edges plus Decision `SUPERSEDES` and `AFFECTS` CodeUnit, Source `REFERENCES` or `PART_OF` Source, and Source `TOUCHES` CodeUnit. Each is `[:R {type}]` in both directions.

| Mode | Query | Shows |
| --- | --- | --- |
| `betweenness` | `CALL algo.betweenness({nodeLabels: ['N'], relationshipTypes: ['R']}) YIELD node, score` | People who bridge otherwise separate parts of the work |
| `components` | `CALL algo.WCC({nodeLabels: ['N'], relationshipTypes: ['R']}) YIELD node, componentId` | Groups with decisions cut off from the largest group |
| `shortest_path` | `CALL algo.SPpaths({sourceNode: a, targetNode: b, relTypes: ['R'], maxLen: 8, pathCount: 1}) YIELD path` | How two items connect, with the edge type of each step |

### People view

`/w/<slug>/people` lists workspace members, plus imported people the caller can see something for, with what they own (`OWNS`), what they changed most (`WORKED_ON`, and the CodeUnits a WorkItem they worked on `TOUCHES`) and the decisions they made. Owned and worked-on items pass the same `shown(x)` check as who_knows; decisions pass `visible(d)` and skip dismissed ones. Hidden items are not counted. A topic search on the same page calls `rankPeople` and shows each person's score split by `kind`.

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (p:Person)-[:OWNS]->(x)
WHERE x.deleted_at IS NULL AND <shown(x)>
RETURN DISTINCT p.id, x.id, labels(x), coalesce(x.path, x.title, x.name) AS name, x.url
```

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (d:Decision)-[:MADE_BY]->(p:Person)
WHERE d.status <> 'dismissed' AND <visible(d)>
OPTIONAL MATCH (d)-[:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source)
WHERE s.url IS NOT NULL AND <visible(s)>
RETURN p.id, d.id, d.title, d.status, collect(s.url) AS urls
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

### Changes since

`changes_since(since, until)` lists what changed in a window, newest first, paged with `skip` and `limit`. `since` and `until` are UTC; `until` defaults to now. One `UNION ALL` query, every branch starting from the caller and filtered by `visible`:

| Change | Time property |
| --- | --- |
| Decision created (not dismissed) | `recorded_at` |
| Decision superseded, with the visible replacement | `valid_to` |
| Proposal accepted | `confirmed_at` (set only by accepting a proposal) |
| Decision flagged: an accepted Decision whose visible Source changed (same check as Source changes) | `coalesce(s.deleted_at, s.updated_at)` |
| Source edited | `updated_at`, when later than `created_at` |
| Source deleted | `deleted_at` |

Rows are sorted and paged in application code. A date-time without a zone is read as UTC.

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (d:Decision {status: 'superseded'})
WHERE d.valid_to >= localdatetime($since) AND d.valid_to < localdatetime($until) AND <visible(d)>
OPTIONAL MATCH (n:Decision)-[:SUPERSEDES]->(d) WHERE n.status IN ['accepted', 'superseded'] AND <visible(n)>
WITH d, collect(DISTINCT n.id) AS replacedBy
RETURN 'decision superseded' AS kind, d.id, d.title, d.valid_to AS at, replacedBy[0]
```

### Check answer

`check_answer(statements: [{text, decision_ids}])` checks an answer before the agent gives it. The brain instructions tell the agent to call it before any final answer that cites decisions. For each cited id:

- `not_found_or_not_visible`: no Decision with that id passes `visible(d)`. A missing and a hidden decision give the same reply, so nothing about a restricted one leaks.
- `superseded`: status `superseded`, or an accepted or superseded Decision `SUPERSEDES` it. `replaced_by` lists only replacements the caller can see.
- `flagged`: accepted, but a visible Source changed since the link was stamped (Source changes).
- `not_accepted`: status `proposed` or `dismissed`.
- `current`: none of the above.

A statement takes the worst verdict of the decisions it cites, in that order. A statement with no ids is `unsourced`.

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (d:Decision) WHERE d.id IN $ids AND <visible(d)>
OPTIONAL MATCH (n:Decision)-[:SUPERSEDES]->(d) WHERE n.status IN ['accepted', 'superseded'] AND <visible(n)>
OPTIONAL MATCH (d)-[link:DERIVED_FROM]->(:Excerpt)-[:IN]->(s:Source) WHERE <visible(s)> AND <sourceChanged(link, s)>
RETURN d.id, d.title, d.status, collect(DISTINCT {id: n.id, title: n.title}) AS replacedBy, count(DISTINCT s) AS changedSources
```

### Conflict hints

`review_source_changes list` also lists pairs of current Decisions (accepted, visible, no changed visible Source) that are `ABOUT` or `AFFECT` the same node (the node must pass `shown(x)`), most shared targets first, at most 200 pairs. Axon makes no LLM call, so it cannot tell whether two decisions disagree: it shows both statements and the agent and the person judge. Each pair names the decision more likely to hold, from the strongest visible Source behind each:

1. `Doc` (ADRs are Docs)
2. `WorkItem`, `PR`, `Commit`
3. `Message`, `Thread`, `Meeting`, `Conversation`
4. no visible Source

At the same rank the newer one (`coalesce(valid_from, recorded_at)`) wins. This is a suggestion only: nothing writes `SUPERSEDES` automatically. A person settles it with `supersede` or `save_session`.

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (a:Decision {status: 'accepted'})-[:ABOUT|AFFECTS]->(x)<-[:ABOUT|AFFECTS]-(b:Decision {status: 'accepted'})
WHERE a.id < b.id AND <visible(a)> AND <visible(b)> AND <shown(x)>
RETURN a.id, b.id, collect(DISTINCT coalesce(x.path, x.name)) AS targets
```

### Saved answers

An answer the person wants to keep is saved with `save_answer` and goes stale on its own when what it cites changes.

```
(:Answer {id, question, statements: [text, ...], cite_key, status: 'current' | 'stale', sensitivity, saved_by, saved_at,
          stale_reason, stale_at, stale_decision_id})
(Answer)-[:CITES {statement}]->(Decision)
(Person)-[:SAVED]->(Answer)
(Answer)-[:VISIBLE_TO]->(Team | Role | Person)
```

- `statements` holds the text of each statement, and `CITES.statement` is the index of the statement that cites the decision.
- Every cited decision must be `current` by the same check as `check_answer` (`lib/brain/citations.ts`): visible, `accepted`, no visible accepted or superseded decision `SUPERSEDES` it, and no visible Source changed since it was recorded. Otherwise nothing is written and the reply gives each decision's verdict and replacement.
- The Answer copies the `VISIBLE_TO` edges of its narrowest cited decision (restricted, then team, then public). Reads also require every cited decision to be visible, which covers two restricted decisions naming different people.
- Saving the same question, statements and citations again while the caller's earlier Answer is current writes nothing. `cite_key` is the sorted `statement:decision_id` pairs.
- The Answer, its `VISIBLE_TO` edges and its `CITES` edges are written in one query, so an Answer never exists without its audience.
- An Answer goes stale when a cited decision is superseded (`supersedeDecision`, used by `supersede` and save_session "change") or when the connector writer updates a Source behind a cited decision so that `sourceChanged` holds. `stale_reason` names only the cited decision. The replacing decision is looked up at read time and shown only when the reader can see it. A stale Answer stays stale.
- The workspace home has a Saved answers tab, stale first, linking cited and replacing decisions to `/w/<slug>?decision=<id>`.

```cypher
MATCH (a:Answer {status: 'current'})-[:CITES]->(d:Decision {id: $oldId})
WITH DISTINCT a, d
SET a.status = 'stale', a.stale_at = localdatetime(), a.stale_decision_id = d.id,
    a.stale_reason = '"' + d.title + '" was superseded'
```

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
MATCH (a:Answer) WHERE <visible(a)>
OPTIONAL MATCH (a)-[:CITES]->(h:Decision) WHERE NOT <visible(h)>
WITH u, role, a, count(h) AS hidden
WHERE hidden = 0
OPTIONAL MATCH (n:Decision)-[:SUPERSEDES]->(old:Decision)
WHERE old.id = a.stale_decision_id AND n.status IN ['accepted', 'superseded'] AND <visible(n)>
RETURN a.question, a.status, a.stale_reason, n.title AS replaced_by
ORDER BY CASE a.status WHEN 'stale' THEN 0 ELSE 1 END
```

## Plane and Slack

An Admin connects Plane and Slack once per Workspace and Axon keeps them in sync. Each connector turns what it reads into Sources, Persons, Projects and links, and one shared writer puts them in the graph.

| From | Node | Edges |
| --- | --- | --- |
| Plane project | `Project`, id `plane:<id>`, `key` = project identifier (`BIL`) | project lead `OWNS` it |
| Plane work item | `(:WorkItem:Source)`, id `plane:<id>`, `key` = `<identifier>-<sequence_id>` (`BIL-1`) | `PART_OF` its Project, creator `AUTHORED`, assignees `OWNS` |
| Plane comment | `(:Source:Message)`, id `plane:<id>` | `PART_OF` its work item, author `AUTHORED` |
| Plane page | `(:Source:Doc)`, id `plane:<id>`, read on every sync (Plane sends no page webhooks); skipped when the Plane has no Pages API | `PART_OF` its Project, owner `AUTHORED`; a private page is `restricted` to its owner |
| Slack message | `(:Source:Message)`, id `slack:<channel>:<ts>` | author `AUTHORED`, a thread reply is `PART_OF` its root message |
| Plane member, Slack user | `Person` | matched across tools, see below |

- Every connector Source carries `connector`, `external_id`, `url`, `created_at`, `updated_at` and `synced_at`. A deleted message or work item gets `deleted_at` and stays in the graph.
- A Person keeps every tool identity in `external_ids` (`plane:<id>`, `slack:<id>`). A new identity joins an existing Person when one already has that id, or on exact email. Handles never match, because anyone can pick one. Otherwise Axon creates `p_<connector>_<id>`.
- A Plane project that is not explicitly public, or a private Slack channel, is `restricted`: its Sources are `VISIBLE_TO` the Admin Role and the project or channel members. Everything else from these tools is `team`.
- Sync: Plane webhooks (`/api/w/<slug>/plane/webhook`, HMAC in `X-Plane-Signature`), a Plane poll route (`/api/w/<slug>/plane/poll`) that fetches work items updated since the newest `updated_at`, and Slack Events (`/api/webhooks/slack` for every installed team, routed by `team_id`, and the older `/api/w/<slug>/slack/events`; v0 signature, five-minute replay window). Joining or leaving a private channel rewrites who can see its messages.
- Connect: from `/w/<slug>/connectors` an Admin adds Slack through OAuth v2 (`/api/connectors/slack/callback`, signed `state`, bot token stored with its `team_id`; a team connected to another Workspace is refused until it is disconnected there) and Plane through a form (API key, workspace slug, optional self-hosted API URL, which must resolve to public addresses; Plane calls never follow redirects). Axon checks the Plane key, registers its webhook through Plane's v2 webhooks API and keeps the returned secret, or asks the Admin to paste one when Plane refuses. Connecting starts the first import; Sync now repeats it, continuing from the last finished sync, and is refused while another sync is still running.
- Credentials live in the accounts graph on `(:Connector {id: '<provider>:<slug>', provider})-[:FOR]->(:Workspace)`, so agent reads on a Workspace graph can never reach them. Tokens and webhook secrets are `enc_*` properties, AES-256-GCM with `CONNECTOR_ENCRYPTION_KEY` and the connector id as associated data. The same node holds `status`, `error`, `synced_at` and `sync_started_at`. Disconnect deletes it. The Workspace named in `CONNECTORS_WORKSPACE` falls back to the env-var credentials when nothing is stored.

```cypher
MATCH (p:Person)-[:OWNS]->(w:WorkItem:Source {connector: 'plane'})
WHERE w.deleted_at IS NULL AND toLower(w.title) CONTAINS 'refund'
RETURN p.name, w.title, w.url
```

```cypher
MATCH (p:Person)
WHERE any(k IN p.external_ids WHERE k STARTS WITH 'plane:')
  AND any(k IN p.external_ids WHERE k STARTS WITH 'slack:')
RETURN p.name, p.external_ids
```

## GitHub

An Admin installs the Axon GitHub App on the Workspace's repositories from `/w/<slug>/connectors`. GitHub uses the same shared writer as Plane and Slack.

| From | Node | Edges |
| --- | --- | --- |
| Pull request | `(:Source:PR)`, id `github:<owner>/<repo>/pull/<number>`, `branch` = head branch | author `AUTHORED`, `TOUCHES` each changed file |
| Review, PR comment, review comment | `(:Source:Message)`, id `github:<owner>/<repo>/review/<id>`, `/comment/<id>` or `/review-comment/<id>` | `PART_OF` its PR, author `AUTHORED`, a review comment `TOUCHES` its file |
| Default-branch commit | `(:Source:Commit)`, id `github:<owner>/<repo>/commit/<sha>`, `extraction = 'skipped'` | author `AUTHORED`, `TOUCHES` each changed file |
| README.md, `docs/**/*.md` except `docs/archive/`, ADRs | `(:Source:Doc)`, id `github:<owner>/<repo>/doc/<path>` | |
| Changed file | `CodeUnit {kind: 'file', path, repo}`, id `cu:<owner>/<repo>:<path>` | `PART_OF` the repository `CodeUnit {kind: 'repository', path: '/'}` |
| CODEOWNERS `@user` rule | `Person` | `OWNS {via: 'CODEOWNERS'}` every file the rule matches |
| GitHub user | `Person`, `external_ids` `github:<user id>`, `handle` = login | bots are skipped |

- A public repository gives `public` Sources and a private one `team`.
- `WORKED_ON {count, last_at}` is recomputed by the shared writer from `AUTHORED` and `TOUCHES`: how many of a Person's Sources touched a CodeUnit, and when last. Plane and Slack get the same edge when their Sources touch code.
- CODEOWNERS ownership is deleted and rewritten each time the file changes. Team and email owners are skipped because they have no GitHub user to match.
- Sync: the webhook (`/api/webhooks/github`, HMAC in `X-Hub-Signature-256`) answers 202 and writes after the response. A push to the default branch adds its commits and re-reads changed docs and CODEOWNERS, and a removed doc gets `deleted_at`. When the installation's repository selection changes (`installation_repositories`), Sources from removed repositories get `deleted_at` and lose their `REFERENCES`, and added repositories are backfilled. The install callback (`/api/connectors/github/callback`) needs a signed `state` naming the Workspace and a signed-in Admin, then backfills. `npm run github:backfill -- <slug> <installation id>` does the same from a shell.

```cypher
MATCH (p:Person)-[w:WORKED_ON]->(c:CodeUnit {path: $path})
RETURN p.name, w.count, w.last_at
ORDER BY w.count DESC
```

### References between Sources

`(Source)-[:REFERENCES {methods}]->(Source)` links GitHub, Plane and Slack Sources only through explicit references. Names and similar wording never create one. The shared writer (`lib/connectors/links.ts`) runs it for every Batch, so sync, backfill and webhooks all keep it current.

| Reference in title, text or PR branch | Resolves to | Method |
| --- | --- | --- |
| `github.com/<o>/<r>/pull/<n>` or `/issues/<n>` (any tab or fragment) | the PR `github:<o>/<r>/pull/<n>` | `url` |
| `github.com/<o>/<r>/commit/<sha>` or `/pull/<n>/commits/<sha>` | the Commit, when exactly one in that repo starts with the SHA | `url` |
| A bare 7 to 40 character SHA in a GitHub Source | a Commit in the same repo, same rule | `sha` |
| `github.com/<o>/<r>/tree/<branch>[/<path>]` | the PR whose `branch` is the longest match, when exactly one PR has it | `url` |
| Plane `/projects/<id>/issues/<id>`, `/work-items/<id>`, `/pages/<id>` or `/browse/<KEY>` | the WorkItem or page | `url` |
| A key such as `BIL-1`, any case, at word boundaries | the WorkItem with that `key` | `key`, or `branch` when found in a PR branch name |
| Slack `/archives/<channel>/p<ts>` | the Message `slack:<channel>:<ts>` | `url` |

- Fenced and inline code is skipped, so example keys and URLs in code never link.
- Only Sources already in the Workspace graph resolve. Anything else is skipped, and self-references are dropped. A Plane or Slack URL resolves only to a Source stored under the same host, and any reference that matches more than one Source links to none.
- A deleted Source references nothing, so its outgoing edges are removed.
- There is one edge per pair with every method that found it. Each write recomputes a Source's outgoing edges from its current text and deletes the ones whose reference is gone.
- When a Source is written, Sources that already mention its key, PR path, short SHA or permalink are re-scanned too, so it does not matter which connector syncs first. The writer stores a lowercased `ref_text` on each Source for this scan; Sources written before it existed join the scan on their next sync.
- `REFERENCES` grants no access. Recall lists the Sources that a decision's Sources reference, or are referenced by, as `Related:`, and only when both ends are visible to the caller.

```cypher
MATCH (m:Message:Source {connector: 'slack'})-[r:REFERENCES]->(w:WorkItem:Source)
RETURN m.title, r.methods, w.key, w.title
```

## Session capture

A teammate's coding agent saves what a session settled with `save_session`. The agent distills the conversation on the teammate's machine and sends only structured items. Axon makes no LLM call and never stores the transcript.

Items are Decision, Constraint, Assumption, Question and context notes. `Question` is a core node for an open question that a session left unanswered:

```
(:Question {id, text, status: 'open', sensitivity, recorded_at})
(Question)-[:ABOUT]->(Topic)
(Question)-[:DERIVED_FROM]->(Excerpt)
```

Each session becomes one `Source:Conversation` per sensitivity, so its items copy `VISIBLE_TO` edges that match their own sensitivity. Saving again with the same `session_id` reuses it:

```
(:Source:Conversation {id, title, repo, branch, session_id, summary, sensitivity, created_at})
(Person)-[:AUTHORED]->(Conversation)
(Excerpt)-[:IN]->(Conversation)
```

- Every item carries 1 to 3 Excerpts, short verbatim quotes that prove its one-line statement.
- The server scans every field before writing. Items holding keys, tokens or code, or a field over 500 characters (300 for an excerpt), are rejected, and the reply names only the field and the kind of match. Emails, phone numbers and local paths are masked.
- Saving is idempotent per Conversation: a Decision with the same title, a Constraint, Assumption or Question with the same statement, a note with the same excerpt, or an excerpt a Decision already has from this Conversation is not written twice. The `summary` is rebuilt from the notes' Excerpts (`note` property) on every save.
- Decisions, Constraints, Assumptions and notes are written through `writeItem` with the Conversation as their Source, so they copy its `VISIBLE_TO` edges. A Question copies them the same way. Notes become the Conversation's `summary`, one line each, with their Excerpts `IN` it.
- The agent marks each Decision new, repeat or change after calling recall. The person confirms every item in the preview, so new and changed Decisions are saved as `accepted` with `confirmed_by`. A repeat writes no Decision and adds the session's Excerpts to the existing one; if that Decision is still `proposed`, the person's confirmation accepts it.
- A change writes `(new)-[:SUPERSEDES]->(old)` and sets the old Decision's status to `superseded` and `valid_to`, the same as `supersede`. The new Decision keeps the old one's sensitivity unless the session is narrower. Nothing is deleted.
- The server re-checks the agent's call inside the caller's visibility: a referenced Decision must be one the caller can see, and a "new" Decision whose normalized title equals a current visible Decision is linked to it instead.

```cypher
MATCH (u:Person {id: $personId})-[:HAS_ROLE]->(role:Role)
CALL db.idx.fulltext.queryNodes('Decision', $words) YIELD node AS d
WITH u, role, d
WHERE d.status IN ['accepted', 'proposed'] AND <visible(d)>
RETURN d.id, d.title, d.status
```
