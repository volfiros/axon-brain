# Axon

**The company brain that remembers why.**

Axon is a company brain built on [FalkorDB](https://www.falkordb.com/) for [Graph Hacks: Context for AI Agents](https://www.wemakedevs.org/hackathons/falkordb). It captures the decisions a team makes in PRs, chats, tickets and meetings, links them to the people, code and constraints behind them, and warns you when new work goes against a past decision.

Tracks: **Track 03: Company Brain** (primary), **Track 02: Agent Memory and Coordination**.

> Status: design phase. Application code starts when the hackathon opens on Oct 15, 2026, 12:01 AM IST.

## The problem

Early teams make decisions all the time and write few of them down. A choice made in a PR comment or a call is invisible to the next person, and to any AI agent working on the code. That is how known edge cases get reintroduced.

## What Axon does

- **Captures decisions without extra work.** Reads PRs, commits, chat exports and notes, and proposes decisions in an inbox for one-click confirmation.
- **Connects them.** Each decision links to who made it, why (constraints and assumptions), the alternatives rejected, the code or process it affects, and the exact source quote.
- **Surfaces them at the right moment.** When a change touches something a past decision covers, Axon flags it with the reason and source. When a constraint stops being true, Axon lists every decision that depended on it.
- **Respects access.** Roles and visibility live in the graph, and every query is filtered before anything reaches the LLM.

## Graph data model

See [docs/ontology.md](docs/ontology.md) for the full model.

```
(Person)-[:MEMBER_OF]->(Team)          (Person)-[:HAS_ROLE]->(Role)
(Decision)-[:MADE_BY]->(Person)        (Decision)-[:BECAUSE_OF]->(Constraint)
(Decision)-[:AFFECTS]->(CodeUnit)      (Decision)-[:SUPERSEDES]->(Decision)
(Decision)-[:DERIVED_FROM]->(Excerpt)-[:IN]->(Source)
(Source)-[:VISIBLE_TO]->(Team | Role | Person)
```

## Repository layout

```
AGENTS.md           instructions for AI coding agents (CLAUDE.md imports it)
docs/
  product.md        problem, users, demo story
  ontology.md       graph model, customization and access control
  archive/          earlier design exploration (superseded, kept for reference)
demo/
  plane/            sanitized seed data from the earlier task-graph exploration
```

## Setup

Full setup will be added once implementation starts. Planned stack: FalkorDB (Docker), Python backend, React frontend.

Work on feature branches named `<github-username>/<feature>`, for example `volfiros/decision-inbox`.

After cloning, install the git hooks (commit messages follow Conventional Commits, one line, no body):

```bash
npm install
```

Copy the environment template and fill it in:

```bash
cp .env.example .env
```

Run FalkorDB locally:

```bash
docker run -p 6379:6379 -p 3000:3000 -it --rm falkordb/falkordb:latest
```

## Submission checklist

- [ ] Public repository
- [ ] README with setup instructions and graph data model
- [ ] Cypher queries and graph algorithms the product depends on
- [ ] Demo video
- [ ] Live deployment, or complete local setup instructions
- [ ] Tracks named in the submission
- [ ] AI assistance disclosed

## AI assistance

This project uses AI coding assistants. Details of which tools were used and for what will be listed here before submission, as the hackathon rules require.

## Data

All demo data is synthetic or created by the team. No private, personal or restricted data is loaded into the graph.
