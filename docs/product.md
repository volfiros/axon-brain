# Product

## Who it is for

Early-stage startups and small teams (2 to 30 people) who move fast, decide things in chat and PR threads, and rarely write those decisions down.

## The problem

Decisions made in a PR comment, a call or a Slack thread are effectively invisible later. New teammates and AI coding agents don't know they exist, so they undo them and reintroduce edge cases the team already handled.

## Core loop

1. **Capture.** Axon reads the places decisions already happen: PRs, review comments, commits, chat exports, meeting notes and docs.
2. **Confirm.** Likely decisions land in a Decision Inbox. A teammate approves, edits or dismisses each one with one click.
3. **Connect.** A confirmed decision becomes a node linked to its owner, reasons, alternatives, affected code or process, and source.
4. **Surface.** Axon brings the decision up when it matters, without being asked.

## Surfaces

| Surface | Purpose |
| --- | --- |
| My Brief | What changed that affects me, decisions waiting on me, stale things I own, who to ask |
| Ask | Chat with answers that show the graph path and sources |
| Decision Inbox | Extracted decisions to confirm, plus manual `/decide` capture |
| Guard | PR check and MCP server so coding agents check past decisions before editing |

## Collaboration

- Decisions have a status: proposed, accepted, superseded.
- Proposed decisions take comments and a reviewer.
- Handoff: collect everything a person owns and the open decisions, then reassign.
- "Who knows about X": rank people by graph proximity and centrality.

## Access control

- Roles: Admin (founder), Member, Guest.
- Visibility is stored as graph edges and inherited from the source a fact came from.
- Every retrieval starts from the current user and only follows nodes they can see. Filtering happens in the query, never in the prompt.
- When something relevant is restricted, Axon can say a restricted item exists and who to ask, without showing its content.

## Demo story (3 minutes)

1. Ingest a synthetic startup: repo, chat export, meeting notes.
2. The Decision Inbox shows decisions nobody wrote down. Confirm a few.
3. A teammate opens a PR that changes the refund flow. Guard flags that it goes against a past decision, with the reason and source quote.
4. Mark a constraint as no longer true. Axon lists every decision that depended on it.
5. Ask the same question as Admin and as Guest. The answers differ, and the Guest never sees restricted content.

## Scope for the hackathon

Build: GitHub and markdown/chat-export ingestion, decision extraction with the inbox, Ask with sources, Guard (PR check and MCP), three roles with query-level filtering, My Brief.

Cut: live Slack integration (use exports), graph visualization beyond the basics, permission editing in the UI (seed from config).
