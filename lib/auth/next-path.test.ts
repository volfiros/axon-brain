import assert from "node:assert/strict";
import { test } from "node:test";

import { safeNextPath } from "./next-path";

test("Same-site paths come back with their query and fragment", () => {
  assert.equal(safeNextPath("/w/acme"), "/w/acme");
  assert.equal(safeNextPath("/w/acme/decisions?tab=stale#dec_1"), "/w/acme/decisions?tab=stale#dec_1");
  assert.equal(safeNextPath("/"), "/");
});

test("Missing or empty next uses the fallback", () => {
  assert.equal(safeNextPath(null), "/onboarding");
  assert.equal(safeNextPath(undefined), "/onboarding");
  assert.equal(safeNextPath(""), "/onboarding");
  assert.equal(safeNextPath(null, "/w/acme"), "/w/acme");
});

test("Protocol-relative and backslash paths to another host are rejected", () => {
  for (const next of ["//evil.com", "//evil.com/w/acme", "/\\evil.com", "\\\\evil.com", "\\/evil.com"]) {
    assert.equal(safeNextPath(next), "/onboarding", next);
  }
});

test("Absolute URLs and script URLs are rejected", () => {
  for (const next of ["https://evil.com", "http://axon.local/w", "javascript:alert(1)", "data:text/html,hi", "mailto:a@example.com"]) {
    assert.equal(safeNextPath(next), "/onboarding", next);
  }
});

test("Paths that do not start with a slash are rejected", () => {
  for (const next of ["w/acme", " /w/acme", "%2F%2Fevil.com", "evil.com"]) {
    assert.equal(safeNextPath(next), "/onboarding", next);
  }
});

test("Control characters that browsers strip cannot turn a path into another host", () => {
  for (const next of ["/\t/evil.com", "/\n/evil.com", "/\r\n/evil.com"]) {
    assert.equal(safeNextPath(next), "/onboarding", JSON.stringify(next));
  }
});

test("Encoded slashes and backslashes stay encoded inside the path", () => {
  assert.equal(safeNextPath("/%2F%2Fevil.com"), "/%2F%2Fevil.com");
  assert.equal(safeNextPath("/%5Cevil.com"), "/%5Cevil.com");
  assert.equal(safeNextPath("/%09/evil.com"), "/%09/evil.com");
});

test("A path that only looks like a URL stays a path on this site", () => {
  assert.equal(safeNextPath("/javascript:alert(1)"), "/javascript:alert(1)");
  assert.equal(safeNextPath("/@evil.com"), "/@evil.com");
  assert.equal(safeNextPath("/\tevil.com"), "/evil.com");
});

test("Dot segments are resolved and cannot climb above the root", () => {
  assert.equal(safeNextPath("/../../etc"), "/etc");
  assert.equal(safeNextPath("/w/acme/../other"), "/w/other");
});

test("Dot segments cannot resolve into a protocol-relative path", () => {
  for (const next of ["/.//evil.com", "/a/..//evil.com"]) {
    assert.ok(!safeNextPath(next).startsWith("//"), next);
  }
});
