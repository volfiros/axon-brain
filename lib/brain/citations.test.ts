import assert from "node:assert/strict";
import { test } from "node:test";

import { check, SEVERITY, type CitationRow } from "./citations";

function row(extra: Partial<CitationRow> = {}): CitationRow {
  return { id: "dec_1", title: "Manual refunds", status: "accepted", sensitivity: "team", replacedBy: [], changedSources: 0, ...extra };
}

test("A decision the caller cannot see is not found", () => {
  assert.deepEqual(check("dec_9", undefined), { verdict: "not_found_or_not_visible", line: "dec_9: not_found_or_not_visible" });
});

test("A superseded decision names its visible replacements", () => {
  const replacedBy = [
    { id: "dec_2", title: "Automatic refunds" },
    { id: "dec_3", title: "Refunds by tier" },
  ];
  assert.deepEqual(check("dec_1", row({ status: "superseded", replacedBy })), {
    verdict: "superseded",
    line: 'dec_1 "Manual refunds": superseded, replaced_by dec_2 "Automatic refunds", dec_3 "Refunds by tier"',
  });
});

test("A superseded decision whose replacement is hidden says so", () => {
  assert.deepEqual(check("dec_1", row({ status: "superseded" })), {
    verdict: "superseded",
    line: 'dec_1 "Manual refunds": superseded, replaced_by none you can see',
  });
});

test("An accepted decision with a visible superseder counts as superseded", () => {
  assert.equal(check("dec_1", row({ replacedBy: [{ id: "dec_2", title: "Automatic refunds" }] })).verdict, "superseded");
});

test("A decision that is not accepted names its status", () => {
  for (const status of ["proposed", "dismissed"]) {
    assert.deepEqual(check("dec_1", row({ status })), {
      verdict: "not_accepted",
      line: `dec_1 "Manual refunds": not_accepted, its status is ${status}`,
    });
  }
});

test("An accepted decision with a changed source is flagged", () => {
  assert.deepEqual(check("dec_1", row({ changedSources: 2 })), {
    verdict: "flagged",
    line: 'dec_1 "Manual refunds": flagged, its source changed since it was recorded (see review_source_changes)',
  });
});

test("Superseded wins over a changed source, and not accepted wins over flagged", () => {
  assert.equal(check("dec_1", row({ status: "superseded", changedSources: 1 })).verdict, "superseded");
  assert.equal(check("dec_1", row({ status: "proposed", changedSources: 1 })).verdict, "not_accepted");
});

test("An accepted decision with unchanged sources is current", () => {
  assert.deepEqual(check("dec_1", row()), { verdict: "current", line: 'dec_1 "Manual refunds": current' });
});

test("SEVERITY lists every verdict from worst to current", () => {
  assert.deepEqual([...SEVERITY], ["not_found_or_not_visible", "superseded", "flagged", "not_accepted", "current"]);
});
