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

## Accounts graph

The shared `<prefix>_accounts` graph holds sign-in identity and the index of Workspaces (ADR 0001).

```
(Account)-[:JOINED {at}]->(Workspace)
(Invite)-[:FOR]->(Workspace)
(Connector)-[:FOR]->(Workspace)
```

- `Workspace {id, slug, name, created_at}`: `slug` is stable and names the Workspace graph and its `/w/<slug>/mcp` address.
- `Invite {code, created_at, expires_at}`: one live invite per Workspace, valid for 7 days. Joining through it adds a Person with the Guest Role.
- `Connector {provider, installation_id}`: written by the connectors feature.
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
