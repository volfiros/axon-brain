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
(Source | Decision | Constraint)-[:VISIBLE_TO]->(Team | Role | Person)
sensitivity: 'public' | 'team' | 'restricted'
```

- Visibility is inherited from the source. A decision extracted from a restricted thread is restricted by default.
- Every retrieval starts from the user and only follows visible nodes.
- One FalkorDB graph per workspace for isolation between companies.

```cypher
MATCH (u:Person {id: $uid})-[:MEMBER_OF|HAS_ROLE*1..2]->(g)<-[:VISIBLE_TO]-(d:Decision)
WHERE d.status = 'accepted' AND (d)-[:AFFECTS]->(:CodeUnit {path: $path})
RETURN d
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
