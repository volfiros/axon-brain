import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_EXCERPT_LENGTH, MAX_FIELD_LENGTH } from "./redact";
import { SAVE_SESSION_RULES, SAVE_SESSION_TEMPLATE } from "./template";

test("The rules and the template state the same length caps the server enforces", () => {
  for (const text of [SAVE_SESSION_RULES, SAVE_SESSION_TEMPLATE]) {
    assert.ok(text.includes(`under ${MAX_EXCERPT_LENGTH} characters`));
    assert.ok(text.includes(`under ${MAX_FIELD_LENGTH} characters`));
    assert.ok(!text.includes("${"));
  }
});

test("The template names all five item kinds", () => {
  for (const kind of ["decision", "constraint", "assumption", "question", "note"]) {
    assert.match(SAVE_SESSION_TEMPLATE, new RegExp(`^- ${kind}: `, "m"));
  }
});

test("The template lists every match kind recall can set", () => {
  assert.ok(SAVE_SESSION_TEMPLATE.includes('{ "kind": "new" }'));
  assert.ok(SAVE_SESSION_TEMPLATE.includes('{ "kind": "repeat", "decision_id": "<id>" }'));
  assert.ok(SAVE_SESSION_TEMPLATE.includes('{ "kind": "change", "decision_id": "<id>" }'));
});

test("Both texts ask for a preview before saving and keep the transcript local", () => {
  for (const text of [SAVE_SESSION_RULES, SAVE_SESSION_TEMPLATE]) {
    assert.ok(text.includes('"preview"'));
    assert.ok(text.includes('"save"'));
    assert.ok(text.indexOf('"preview"') < text.indexOf('"save"'));
    assert.match(text, /transcript/);
  }
});

test("The template tells the agent to strip secrets, personal details and local paths", () => {
  assert.ok(SAVE_SESSION_TEMPLATE.includes("API keys, tokens, passwords"));
  assert.ok(SAVE_SESSION_TEMPLATE.includes("emails, phone numbers"));
  assert.ok(SAVE_SESSION_TEMPLATE.includes("C:\\Users\\name\\..."));
});
