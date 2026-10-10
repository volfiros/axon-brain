# AGENTS.md

Axon is a company brain on FalkorDB for the Graph Hacks hackathon (Oct 15 to 18, 2026, submissions close Oct 18, 11:59 PM IST). Product: [docs/product.md](docs/product.md). Graph model: [docs/ontology.md](docs/ontology.md). `docs/archive/` is superseded exploration; the current docs win where they disagree.

This file is the single source of instructions. `CLAUDE.md` imports it, so edit this file and leave `CLAUDE.md` as the import line.

## Workflow

- Propose before implementing: say what you will change and what you will leave alone, then wait for approval.
- Work on the current branch in the existing checkout. Create branches or worktrees only when asked.
- Keep changes scoped to the task, with the fewest files touched. Add dependencies, abstractions or config only when the task needs them.
- Report what changed, the command you ran to verify it and its result, and anything skipped.

## Hackathon rules that shape the code

- FalkorDB does real work: if the product still runs with FalkorDB removed, the design is wrong.
- Demo data is synthetic or the team's own. Keep private, personal or login-protected data out of the graph and the repo.
- Every teammate must be able to explain the graph model, queries and architecture, so prefer plain, readable code.
- AI assistance is disclosed in the README before submission.

## Code comments

Write self-explanatory code with no comments by default. Add a one-line comment only for a non-obvious why: a FalkorDB quirk, a workaround, a rule from the hackathon, or a security boundary. Docstrings only on public functions whose behavior the name cannot carry.

## FalkorDB (verified on 4.18.1)

- Time: use `localdatetime()`, `date()`, `duration()`, stored in UTC. `datetime()` does not exist.
- Properties are primitives or arrays of primitives. Model maps as flat properties or separate nodes.
- Label alternatives go in `WHERE n:A OR n:B`. `MATCH (n:A|B)` is unsupported.
- Existence checks use pattern predicates (`WHERE (a)-[:R]->(b)`). `EXISTS { }` is unsupported.
- `shortestPath` must be directed and sit in `WITH` or `RETURN`. For other path questions use `algo.SPpaths` or `algo.BFS`.
- Vector `score` is a distance: lower is closer. Vector search cannot filter during the search, so over-fetch then filter.
- Algorithms available: `algo.pageRank`, `algo.betweenness`, `algo.WCC`, `algo.labelPropagation`, `algo.BFS`, `algo.SPpaths`, `algo.SSpaths`, `algo.MSF`.

## Access control and agent reads

- Filter by access inside the Cypher query, starting from the requesting user. The LLM only ever sees rows that passed the filter.
- Agent and API reads go through `GRAPH.RO_QUERY` (`ro_query` in the client). Writes go through application code paths only.
- One graph per workspace for isolation between companies.

## Schema changes

When nodes, relationships or core queries change, update [docs/ontology.md](docs/ontology.md) in the same change. The README's graph model section and the submitted Cypher queries come from it.

## Git

- Commit or push only when asked.
- Commit messages are a single Conventional Commits subject line (`feat(guard): flag decided files`), max 72 characters, no body, no trailers. Husky and commitlint enforce this through the `commit-msg` hook installed by `npm install`.

## Secrets and local files

- Secrets live in `.env` (template: `.env.example`). Raw exports, receipts and reference PDFs live in `.private/`. Both are git-ignored.
- Read secret values only when a task needs them, and keep them out of code, logs, docs and commits.
