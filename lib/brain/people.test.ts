import assert from "node:assert/strict";
import { test } from "node:test";

import type { Row } from "@/lib/graph/client";
import { fakeContext } from "@/tests/helpers/fake-context";

import { listPeople, rankPeople } from "./people";

function signal(personId: string, kind: string, text: string, points: number): Row {
  return { personId, name: `Name ${personId}`, title: null, onAxon: true, kind, signal: text, points };
}

function ranked(signals: Row[]) {
  return fakeContext((cypher) => (cypher.includes("'owns' AS kind") ? signals : []));
}

test("rankPeople returns null without running a query when the topic has no searchable words", async () => {
  const { ctx, calls } = ranked([]);
  assert.equal(await rankPeople(ctx, "the and of"), null);
  assert.equal(calls.length, 0);
});

test("rankPeople returns an empty list when no one has a signal", async () => {
  const { ctx, calls } = ranked([]);
  assert.deepEqual(await rankPeople(ctx, "refunds"), []);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params.stems, ["refund"]);
});

test("rankPeople adds up each person's points by kind with a reason per signal", async () => {
  const { ctx } = ranked([
    signal("p_a", "owns", "owns src/billing", 5),
    signal("p_a", "workedOn", "changed src/billing 4 times", 2),
    signal("p_b", "decisions", "decided Manual refunds", 3),
  ]);
  const [first, second] = (await rankPeople(ctx, "billing"))!;
  assert.deepEqual(first, {
    personId: "p_a",
    name: "Name p_a",
    title: null,
    onAxon: true,
    score: 7,
    breakdown: { owns: 5, decisions: 0, authored: 0, workedOn: 2, centrality: 0 },
    reasons: ["owns src/billing (+5)", "changed src/billing 4 times (+2)"],
  });
  assert.equal(second.personId, "p_b");
  assert.equal(second.score, 3);
});

test("rankPeople counts a repeated signal for the same person once", async () => {
  const { ctx } = ranked([signal("p_a", "owns", "owns src/billing", 5), signal("p_a", "owns", "owns src/billing", 5)]);
  const [person] = (await rankPeople(ctx, "billing"))!;
  assert.equal(person.score, 5);
  assert.equal(person.reasons.length, 1);
});

test("rankPeople keeps the top five by score", async () => {
  const signals = [1, 2, 3, 4, 5, 6, 7].map((n) => signal(`p_${n}`, "authored", `wrote doc ${n}`, n));
  const { ctx } = ranked(signals);
  assert.deepEqual((await rankPeople(ctx, "billing"))!.map((p) => p.personId), ["p_7", "p_6", "p_5", "p_4", "p_3"]);
});

function peopleContext(rows: { people?: Row[]; owns?: Row[]; worked?: Row[]; decisions?: Row[] }) {
  return fakeContext((cypher) => {
    if (cypher.includes("r.name AS role")) return rows.people ?? [];
    if (cypher.includes("[:OWNS]")) return rows.owns ?? [];
    if (cypher.includes("WORKED_ON")) return rows.worked ?? [];
    if (cypher.includes("MADE_BY")) return rows.decisions ?? [];
    return [];
  });
}

const ADA = { id: "p_ada", name: "Ada", title: "Engineer", role: "Member", onAxon: true };
const IMPORTED = { id: "p_imp", name: "Imported", title: null, role: null, onAxon: false };

test("listPeople keeps members with nothing yet and drops imported people with nothing visible", async () => {
  const { ctx } = peopleContext({ people: [ADA, IMPORTED] });
  assert.deepEqual(await listPeople(ctx), [{ ...ADA, owns: [], workedOn: [], decisions: [] }]);
});

test("listPeople groups owned items, work and decisions under each person", async () => {
  const { ctx } = peopleContext({
    people: [ADA, IMPORTED],
    owns: [{ personId: "p_imp", id: "cu_1", labels: ["CodeUnit"], name: "src/billing", url: null }],
    worked: [
      { personId: "p_ada", id: "cu_1", labels: ["CodeUnit"], name: "src/billing", url: null, count: 2, via: null },
      { personId: "p_ada", id: "pr_1", labels: ["Source", "WorkItem"], name: "BIL-1", url: "https://example.com/BIL-1", count: 5, via: null },
      { personId: "p_ada", id: "cu_1", labels: ["CodeUnit"], name: "src/billing", url: null, count: 4, via: "BIL-2" },
      { personId: "p_gone", id: "cu_9", labels: ["CodeUnit"], name: "x", url: null, count: 9, via: null },
    ],
    decisions: [
      { personId: "p_ada", id: "dec_1", title: "Manual refunds", status: "accepted", sensitivity: "restricted", at: "2026-10-01T09:00:00", urls: ["https://example.com/a", "https://example.com/b"] },
      { personId: "p_ada", id: "dec_2", title: "Refund limits", status: "proposed", sensitivity: null, at: null, urls: [] },
    ],
  });
  const [ada, imported] = await listPeople(ctx);
  assert.deepEqual(ada.workedOn, [
    { id: "cu_1", kind: "CodeUnit", name: "src/billing", url: null, count: 6, via: ["BIL-2"] },
    { id: "pr_1", kind: "WorkItem", name: "BIL-1", url: "https://example.com/BIL-1", count: 5, via: [] },
  ]);
  assert.deepEqual(ada.decisions, [
    { id: "dec_1", title: "Manual refunds", status: "accepted", restricted: true, date: "2026-10-01", url: "https://example.com/a" },
    { id: "dec_2", title: "Refund limits", status: "proposed", restricted: false, date: "unknown date", url: null },
  ]);
  assert.deepEqual(imported.owns, [{ id: "cu_1", kind: "CodeUnit", name: "src/billing", url: null }]);
});

test("listPeople names an item by its first label when it is none of the known kinds", async () => {
  const { ctx } = peopleContext({
    people: [ADA],
    owns: [{ personId: "p_ada", id: "t_1", labels: ["Team"], name: "Payments", url: null }],
  });
  assert.equal((await listPeople(ctx))[0].owns[0].kind, "Team");
});
