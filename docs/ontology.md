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
```

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
(Source | Project | Decision | Constraint | Assumption)-[:VISIBLE_TO]->(Team | Role | Person)
sensitivity: 'public' | 'team' | 'restricted'
```

- `public` is visible to Admin, Member and Guest. `team` is visible to Admin and Member. `restricted` is visible to Admin, or to the specific Team or Person it names.
- Visibility is inherited from the source. A decision extracted from a restricted thread is restricted by default.
- Every retrieval starts from the user and only follows visible nodes.
- One FalkorDB graph per workspace for isolation between companies.
- A Person points to its Account with `account_id`. Accounts live in the shared accounts graph (ADR 0001). A Person seen only in imported data has no `account_id`.

```cypher
MATCH (u:Person {id: $uid})-[:MEMBER_OF|HAS_ROLE*1..2]->(g)<-[:VISIBLE_TO]-(d:Decision)
WHERE d.status = 'accepted' AND (d)-[:AFFECTS]->(:CodeUnit {path: $path})
RETURN d
```

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

## Agent tools

| Tool | Purpose |
| --- | --- |
| `find_decisions(target)` | Decisions affecting a file, process or topic |
| `why(decision)` | Reasons, alternatives and sources |
| `impact(node)` | What depends on a constraint or decision |
| `who_knows(topic)` | People ranked by ownership, work history and centrality |
| `what_changed(since, person)` | Feed for My Brief |
| `propose_decision(...)` | Writes to the inbox, never straight to the graph |

## Plane and Slack

An Admin connects Plane and Slack once per Workspace and Axon keeps them in sync. Each connector turns what it reads into Sources, Persons, Projects and links, and one shared writer puts them in the graph.

| From | Node | Edges |
| --- | --- | --- |
| Plane project | `Project`, id `plane:<id>` | project lead `OWNS` it |
| Plane work item | `(:WorkItem:Source)`, id `plane:<id>` | `PART_OF` its Project, creator `AUTHORED`, assignees `OWNS` |
| Plane comment | `(:Source:Message)`, id `plane:<id>` | `PART_OF` its work item, author `AUTHORED` |
| Slack message | `(:Source:Message)`, id `slack:<channel>:<ts>` | author `AUTHORED`, a thread reply is `PART_OF` its root message |
| Plane member, Slack user | `Person` | matched across tools, see below |

- Every connector Source carries `connector`, `external_id`, `url`, `created_at`, `updated_at` and `synced_at`. A deleted message or work item gets `deleted_at` and stays in the graph.
- A Person keeps every tool identity in `external_ids` (`plane:<id>`, `slack:<id>`). A new identity joins an existing Person when one already has that id, or on exact email. Handles never match, because anyone can pick one. Otherwise Axon creates `p_<connector>_<id>`.
- A Plane project that is not explicitly public, or a private Slack channel, is `restricted`: its Sources are `VISIBLE_TO` the Admin Role and the project or channel members. Everything else from these tools is `team`.
- Sync: Plane webhooks (`/api/w/<slug>/plane/webhook`, HMAC in `X-Plane-Signature`), a Plane poll route (`/api/w/<slug>/plane/poll`) that fetches work items updated since the newest `updated_at`, and Slack Events (`/api/w/<slug>/slack/events`, v0 signature, five-minute replay window). Joining or leaving a private channel rewrites who can see its messages.

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
