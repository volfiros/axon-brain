import assert from "node:assert/strict";
import { test } from "node:test";

import { ownersOf, parseCodeowners } from "./codeowners";

function owners(text: string, path: string): string[] {
  return ownersOf(parseCodeowners(text), path);
}

test("Comments and blank lines are ignored", () => {
  const rules = parseCodeowners("# owners\n\n*.ts @ada # TypeScript\n");
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].owners, ["ada"]);
});

test("Only @user owners are kept, not teams or emails", () => {
  assert.deepEqual(owners("* @ada @acme/payments grace@example.test", "x.ts"), ["ada"]);
});

test("The last matching rule wins", () => {
  const text = "* @ada\nsrc/ @grace";
  assert.deepEqual(owners(text, "src/refunds.ts"), ["grace"]);
  assert.deepEqual(owners(text, "README.md"), ["ada"]);
});

test("A path with no matching rule has no owners", () => {
  assert.deepEqual(owners("docs/ @ada", "src/app.ts"), []);
});

test("An unanchored file pattern matches at any depth", () => {
  assert.deepEqual(owners("*.md @ada", "docs/deep/notes.md"), ["ada"]);
  assert.deepEqual(owners("*.md @ada", "notes.mdx"), []);
});

test("A leading slash anchors the pattern to the repository root", () => {
  assert.deepEqual(owners("/build/ @ada", "build/out.js"), ["ada"]);
  assert.deepEqual(owners("/build/ @ada", "src/build/out.js"), []);
});

test("A directory pattern covers everything below it", () => {
  assert.deepEqual(owners("docs/ @ada", "docs/a/b/c.md"), ["ada"]);
  assert.deepEqual(owners("apps @ada", "apps/web/page.tsx"), ["ada"]);
});

test("dir/* covers only files directly inside the directory", () => {
  assert.deepEqual(owners("docs/* @ada", "docs/product.md"), ["ada"]);
  assert.deepEqual(owners("docs/* @ada", "docs/adr/0001.md"), []);
});

test("** matches across directories", () => {
  assert.deepEqual(owners("**/migrations @ada", "db/a/migrations/001.sql"), ["ada"]);
  assert.deepEqual(owners("src/**/test.ts @ada", "src/test.ts"), ["ada"]);
  assert.deepEqual(owners("src/**/test.ts @ada", "src/a/b/test.ts"), ["ada"]);
});

test("? matches exactly one character other than a slash", () => {
  assert.deepEqual(owners("v?.txt @ada", "v1.txt"), ["ada"]);
  assert.deepEqual(owners("v?.txt @ada", "v10.txt"), []);
});

test("Dots in patterns are literal", () => {
  assert.deepEqual(owners("package.json @ada", "packageXjson"), []);
});
