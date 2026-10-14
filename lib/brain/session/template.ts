import { MAX_EXCERPT_LENGTH, MAX_FIELD_LENGTH } from "./redact";

export const SAVE_SESSION_RULES = `Distill on this machine. Send Axon only structured items, never the transcript.
Item kinds: decision, constraint, assumption, question, note. Nothing else.
Every item has a one-line statement for search and 1 to 3 verbatim excerpts as proof, each under ${MAX_EXCERPT_LENGTH} characters, copied word for word from the conversation. Every other field stays under ${MAX_FIELD_LENGTH} characters.
Keep specifics exactly as said: numbers, names, conditions and caveats such as "only for v1" or "until we have 10 customers".
A decision's statement says why it was chosen. It also lists its constraints and assumptions, each rejected alternative with the reason, what it affects (repo-relative file paths, components, processes) and who decided it.
Strip keys, tokens, .env values, personal details (emails, phone numbers), local paths, file contents and code. The server rejects or masks anything that slips through.
Leave out anything unrelated to the workspace: debugging dead ends, tool output, side topics, personal chat.
Before proposing a decision, call recall on its topic and mark it new, repeat (same as an existing decision) or change (replaces an existing decision).
Call save_session with step "preview" first, show the person each statement beside its excerpts, let them edit or untick items, then call step "save" with only the confirmed items.`;

export const SAVE_SESSION_TEMPLATE = `# Save this session to Axon

You have this conversation in context. Distill the parts the team should remember into structured items and save them with the save_session tool. Only the items leave this machine. The transcript never does.

## What to keep

Five kinds of item:

- decision: a choice that was made. Not an idea that was floated and dropped.
- constraint: a fact that limits choices, such as a budget, a vendor limit, a compliance rule or team size.
- assumption: something the team is treating as true without having checked it.
- question: an open question that is still unanswered at the end of the session.
- note: context a teammate would need later that is none of the above.

## How to write each item

- statement: one line in plain words, written for search. For a decision, also give a short title.
- excerpts: 1 to 3 short quotes copied word for word from the conversation, each under ${MAX_EXCERPT_LENGTH} characters. The excerpt is the proof and the statement must not say more than it does.
- Keep specifics exactly as said: numbers, names, conditions and caveats such as "only for v1" or "until we have 10 customers". Never round, generalize or drop a condition.
- about: one to three short topic names, such as "refunds" or "auth".
- Every other field stays under ${MAX_FIELD_LENGTH} characters. Items with longer fields, code or secrets are not saved.

A decision also carries:

- title: a short name.
- statement: what was decided and why, in one line, for example "Refunds over $500 wait for manual approval because the processor freezes payouts on large unapproved refunds".
- new_constraints and new_assumptions: the facts it rests on, one sentence each. Use because_ids instead for ones recall already returned.
- rejected: each option that was considered and dropped, as { "title", "reason" }.
- affects: what it changes, as repo-relative file paths (src/billing/refunds.ts), components or processes.
- made_by: who decided it, as a teammate's handle or name. Leave it out if it was the person you are working with.

## What to leave out

Leave these out of every field, including excerpts:

- API keys, tokens, passwords, connection strings and any .env value
- personal details: emails, phone numbers, home addresses, anything about someone's private life
- local paths such as /Users/name/... or C:\\Users\\name\\...
- file contents, code, stack traces, logs and tool output
- anything unrelated to the workspace: debugging dead ends, side topics, personal chat, small talk

If a decision cannot be stated without one of these, describe it without the value ("rotate the payments API key monthly", not the key).

## Check what Axon already knows

For each decision, call recall on its topic before you propose it, and set match:

- { "kind": "new" } when nothing existing covers it
- { "kind": "repeat", "decision_id": "<id>" } when it restates an existing decision. Axon adds this session as another source for it.
- { "kind": "change", "decision_id": "<id>" } when it replaces an existing decision. Axon saves the new decision and marks the old one superseded, keeping it as history.

Judge by meaning, not wording. A reworded decision is a repeat.

## Confirm with the person, then save

1. Call save_session with step "preview" and every item. Nothing is written yet.
2. Show the person the short list: each statement beside its excerpts, what Axon masked or rejected, and whether it is new, a repeat or a change. Use a multi-select question when there are four items or fewer, otherwise a numbered list.
3. Let them edit any statement or untick any item. If an item was rejected, fix it or drop it.
4. Call save_session with step "save" and only the items they confirmed.

Session details to send: a short title, the repo as owner/name, the branch, this session's id if you know it, and sensitivity (public, team or restricted; team when unsure).
`;
