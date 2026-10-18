import assert from "node:assert/strict";
import { test } from "node:test";

import { utc } from "./changes-since";

test("A bare date is read as midnight UTC", () => {
  assert.equal(utc("2026-10-01"), "2026-10-01T00:00:00");
});

test("A date-time without a zone is read as UTC", () => {
  assert.equal(utc("2026-10-01T09:30"), "2026-10-01T09:30:00");
  assert.equal(utc("2026-10-01T09:30:15"), "2026-10-01T09:30:15");
});

test("A date-time with a zone is converted to UTC", () => {
  assert.equal(utc("2026-10-01T09:30:00Z"), "2026-10-01T09:30:00");
  assert.equal(utc("2026-10-01T09:30:00+05:30"), "2026-10-01T04:00:00");
  assert.equal(utc("2026-10-01T09:30:00-0200"), "2026-10-01T11:30:00");
});

test("Text that is not a date throws with an example", () => {
  assert.throws(() => utc("last tuesday"), { message: "Not a date: last tuesday. Use a form like 2026-10-01." });
  assert.throws(() => utc("2026-13-45T00:00"), /Not a date/);
});
