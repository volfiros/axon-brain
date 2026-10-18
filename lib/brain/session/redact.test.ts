import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_EXCERPT_LENGTH, MAX_FIELD_LENGTH, redactItem } from "./redact";

function rejectedAs(text: string): string[] {
  return redactItem(text).rejected.map((f) => f.detail);
}

function masked(text: string): string {
  return redactItem(text).value;
}

const SECRETS: [name: string, text: string][] = [
  ["private key", "-----BEGIN RSA PRIVATE KEY-----"],
  ["private key", "-----BEGIN PRIVATE KEY-----"],
  ["private key", "-----BEGIN OPENSSH PRIVATE KEY-----"],
  ["AWS access key", "use AKIAABCDEFGHIJKLMNOP for uploads"],
  ["AWS access key", "ASIAABCDEFGHIJKLMNOP"],
  ["GitHub token", `ghp_${"a".repeat(36)}`],
  ["GitHub token", `gho_${"B".repeat(30)}`],
  ["GitHub token", `github_pat_${"A1_".repeat(12)}`],
  ["Slack token", "xoxb-1234567890-abcdef"],
  ["Slack token", "xapp-1-A0123456789"],
  ["Hugging Face token", "hf_abcdefghijklmnopqrstuv"],
  ["Stripe key", "sk_live_abcdefghijklmnop"],
  ["Stripe key", "rk_test_abcdefghijklmnop"],
  ["Google API key", `AIza${"a".repeat(35)}`],
  ["API key", "sk-abcdefghijklmnopqrstu"],
  ["JWT", "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.abcdefghijkl"],
  ["credentials in a URL", "postgres://admin:hunter2@db.example.com/app"],
  ["environment secret", "STRIPE_SECRET_KEY=whatever"],
  ["environment secret", "DB_PASSWORD = abc"],
  ["environment secret", "GITHUB_TOKEN=abc"],
  ["authorization header", "Authorization: Bearer abcdefghij"],
  ["bearer token", "send Bearer abcdefghijklmnop"],
  ["bearer token", "Bearer abcdefg1"],
  ["bearer token", "Token a1b2c3d4"],
  ["bearer token", "Basic YWxpY2U6aHVudGVyMg=="],
  ["secret assignment", "api_key: abc123"],
  ["secret assignment", "APIKEY=1"],
  ["secret assignment", "client_secret=foo"],
  ["secret assignment", "access-key: zz"],
  ["secret assignment", "passwd=x"],
  ["secret assignment", "pwd: secret1"],
  ["secret assignment", "password: hunter2"],
  ["secret assignment", "password: swordfish"],
  ["secret assignment", "password: swordfish, then rotate"],
  ["secret assignment", "password = swordfish rotated"],
  ["secret assignment", "password: 'swordfish' rotated"],
  ["long hex string", "abcdef0123456789abcdef0123456789"],
  ["long random-looking string", "aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gI"],
];

for (const [name, text] of SECRETS) {
  test(`Rejects a ${name}: ${text.slice(0, 24)}`, () => {
    assert.deepEqual(rejectedAs(text), [name]);
  });
}

test("Findings for a secret name the field and kind, never the matched text", () => {
  const result = redactItem({ statement: "rotate sk-abcdefghijklmnopqrstu monthly" });
  assert.deepEqual(result.rejected, [{ field: "statement", kind: "secret", detail: "API key" }]);
  assert.ok(!JSON.stringify(result.rejected).includes("sk-abc"));
});

test("A rejected item still comes back with masks applied, so the caller can drop it", () => {
  const result = redactItem({ statement: "postgres://admin:hunter2@db.example.com/app" });
  assert.equal(result.rejected[0].detail, "credentials in a URL");
  assert.equal(result.value.statement, "postgres://admin:[email]/app");
});

test("Near misses of secret formats are not rejected", () => {
  for (const text of ["ghp_short", "sk-short", "the AKIA prefix", "AKIAABCDEFGHIJKLMNOPQ", "Bearer abcdefgh"]) {
    assert.deepEqual(rejectedAs(text), [], text);
  }
});

test("Words like password or token in prose are not read as a credential", () => {
  for (const text of [
    "password: rotated monthly",
    "token: abcd rotated",
    "the secret is that we ship weekly",
    "token budget is small",
    "the token is short",
  ]) {
    assert.deepEqual(rejectedAs(text), [], text);
  }
});

test("Git commit hashes, UUIDs and kebab-case names are not read as random tokens", () => {
  for (const text of [
    "commit da39a3ee5e6b4b0d3255bfef95601890afd80709 fixed it",
    `sha256 ${"ab12".repeat(16)}`,
    "550e8400-e29b-41d4-a716-446655440000",
    "refund-approval-threshold-for-large-orders-v2",
  ]) {
    assert.deepEqual(rejectedAs(text), [], text);
  }
});

test.todo("Rejects an Authorization header with a short Basic or Token credential", () => {
  assert.deepEqual(rejectedAs("Authorization: Basic dXNlcjpwYXNz"), ["authorization header"]);
  assert.deepEqual(rejectedAs("Authorization: Token abcdefghij"), ["authorization header"]);
});

test.todo("Rejects a connection string with a password and no username", () => {
  assert.deepEqual(rejectedAs("redis://:hunter2@cache.example.com"), ["credentials in a URL"]);
});

test("Masks email addresses", () => {
  assert.equal(masked("ab@example.com"), "[email]");
  assert.equal(masked("x@y.co"), "[email]");
  assert.equal(masked("mail alice@example.com or bob@corp.io"), "mail [email] or [email]");
  assert.equal(masked("email alice.smith+tag@mail.example.co.uk today"), "email [email] today");
});

test("Image names with a scale suffix are not read as email addresses", () => {
  assert.equal(masked("logo@2x.png"), "logo@2x.png");
  assert.equal(masked("icon@3x.webp"), "icon@3x.webp");
});

test("Masks international and formatted phone numbers", () => {
  assert.equal(masked("call +1 415 555 0132"), "call [phone]");
  assert.equal(masked("+44 20 7946 0958"), "[phone]");
  assert.equal(masked("+91 98765 43210"), "[phone]");
  assert.equal(masked("(415) 555-0132"), "[phone]");
  assert.equal(masked("415-555-0132"), "[phone]");
  assert.equal(masked("415.555.0132"), "[phone]");
  assert.equal(masked("98765 43210"), "[phone]");
  assert.equal(masked("98765-43210"), "[phone]");
});

test("Masks a bare 10 to 12 digit number only when phone words are nearby", () => {
  assert.equal(masked("call me at 4155550132"), "call me at [phone]");
  assert.equal(masked("phone: 9876543210"), "phone: [phone]");
  assert.equal(masked("text me 919876543210"), "text me [phone]");
  assert.equal(masked("the order id 4155550132"), "the order id 4155550132");
});

test("Bare numbers that are amounts, decimals or too long stay as they are", () => {
  assert.equal(masked("cost $4155550132 call"), "cost $4155550132 call");
  assert.equal(masked("phone 4155550132.5"), "phone 4155550132.5");
  assert.equal(masked("phone 12345678901234"), "phone 12345678901234");
});

test("Masks local paths on macOS, Linux and Windows", () => {
  for (const path of [
    "/Users/alice/projects/x.ts",
    "/home/bob/.ssh/id_rsa",
    "/root/notes",
    "/private/var/folders/xy",
    "/var/folders/ab/cd",
    "C:\\Users\\alice\\Documents",
    "c:\\documents and settings\\bob",
    "~/projects/axon",
  ]) {
    assert.equal(masked(path), "[path]", path);
  }
});

test("Masks a local path inside punctuation and keeps the punctuation", () => {
  assert.equal(masked("see (~/notes)"), "see ([path])");
  assert.equal(masked('"/Users/a/b"'), '"[path]"');
  assert.equal(masked("'/home/x'"), "'[path]'");
  assert.equal(masked("path=/Users/a/b"), "path=[path]");
  assert.equal(masked("~/x and /Users/a/b"), "[path] and [path]");
});

test("Repo-relative paths and URLs that contain /Users are not masked", () => {
  assert.equal(masked("src/billing/refunds.ts"), "src/billing/refunds.ts");
  assert.equal(masked("https://github.com/Users/x"), "https://github.com/Users/x");
  assert.equal(masked("a/Users/b"), "a/Users/b");
  assert.equal(masked("/Users"), "/Users");
});

test("Each kind of mask is reported once per field with its placeholder", () => {
  const result = redactItem({ statement: "mail a@example.com and b@example.com from /Users/a/x" });
  assert.equal(result.value.statement, "mail [email] and [email] from [path]");
  assert.deepEqual(result.masked, [
    { field: "statement", kind: "email", detail: "masked as [email]" },
    { field: "statement", kind: "path", detail: "masked as [path]" },
  ]);
  assert.deepEqual(result.rejected, []);
});

test("Rejects text that looks like code or file contents", () => {
  for (const text of ["```js\nfoo\n```", "a\nb\nc\nd", "a;\nb;", "const x = 1", "x => y", "function foo(", "def foo(", "if (x) {", "foo();"]) {
    assert.deepEqual(rejectedAs(text), ["looks like code or file contents"], JSON.stringify(text));
  }
});

test("Ordinary decision text is untouched and not rejected", () => {
  for (const text of [
    "Refunds over $500 wait for manual approval because the processor freezes payouts.",
    "We chose Postgres over Mongo; joins matter.",
    "Ship v2 on 2026-10-01 for 10 customers.",
    "Ask in #billing, the 2024-10-01 release",
    "Only for v1, until we have 10 customers.",
  ]) {
    assert.deepEqual(redactItem(text), { value: text, masked: [], rejected: [] });
  }
});

test("Excerpts are capped at the excerpt length and other fields at the field length", () => {
  const ok = { statement: "s".repeat(MAX_FIELD_LENGTH), excerpts: ["e".repeat(MAX_EXCERPT_LENGTH)] };
  assert.deepEqual(redactItem(ok).rejected, []);
  const long = { statement: "s".repeat(MAX_FIELD_LENGTH + 1), excerpts: ["e".repeat(MAX_EXCERPT_LENGTH + 1)] };
  assert.deepEqual(redactItem(long).rejected, [
    { field: "statement", kind: "length", detail: `longer than ${MAX_FIELD_LENGTH} characters` },
    { field: "excerpts[0]", kind: "length", detail: `longer than ${MAX_EXCERPT_LENGTH} characters` },
  ]);
});

test("Anything nested under an excerpts key uses the excerpt cap", () => {
  const result = redactItem({ nested: { excerpts: [{ quote: "q".repeat(MAX_EXCERPT_LENGTH + 1) }] } });
  assert.deepEqual(result.rejected, [{ field: "nested.excerpts[0].quote", kind: "length", detail: `longer than ${MAX_EXCERPT_LENGTH} characters` }]);
});

test("Walks arrays and objects, names fields by path and leaves non-strings alone", () => {
  const item = { kind: "decision", about: ["refunds", "ab@example.com"], rejected: [{ title: "t", reason: "call 4155550132" }], n: 5, flag: true, none: null };
  const result = redactItem(item);
  assert.deepEqual(result.value, {
    kind: "decision",
    about: ["refunds", "[email]"],
    rejected: [{ title: "t", reason: "call [phone]" }],
    n: 5,
    flag: true,
    none: null,
  });
  assert.deepEqual(
    result.masked.map((f) => `${f.field} ${f.kind}`),
    ["about[1] email", "rejected[0].reason phone"],
  );
});

test("Does not change the item it was given", () => {
  const item = { statement: "mail a@example.com" };
  redactItem(item);
  assert.equal(item.statement, "mail a@example.com");
});
