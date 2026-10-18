import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { decryptSecret, encryptionConfigured, encryptSecret, isProvider } from "./credentials";

const KEY = randomBytes(32).toString("base64");
process.env.CONNECTOR_ENCRYPTION_KEY = KEY;

const CONTEXT = "plane:acme:token";

function withKey(value: string | undefined, run: () => void) {
  if (value === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY;
  else process.env.CONNECTOR_ENCRYPTION_KEY = value;
  try {
    run();
  } finally {
    process.env.CONNECTOR_ENCRYPTION_KEY = KEY;
  }
}

function flipFirstByte(part: string): string {
  const bytes = Buffer.from(part, "base64url");
  bytes[0] ^= 0x01;
  return bytes.toString("base64url");
}

test("A secret decrypts back to itself in the same context", () => {
  for (const plaintext of ["plane_api_key_123", "", "unicode ✓ ключ"]) {
    assert.equal(decryptSecret(encryptSecret(plaintext, CONTEXT), CONTEXT), plaintext);
  }
});

test("Encrypting twice gives different ciphertexts in the v1 format", () => {
  const a = encryptSecret("same", CONTEXT);
  const b = encryptSecret("same", CONTEXT);
  assert.notEqual(a, b);
  assert.match(a, /^v1\.[\w-]+\.[\w-]+\.[\w-]*$/);
  assert.equal(a.includes("same"), false);
});

test("A secret copied to another connector or field fails to decrypt", () => {
  const stored = encryptSecret("plane_api_key_123", CONTEXT);
  assert.throws(() => decryptSecret(stored, "plane:other:token"));
  assert.throws(() => decryptSecret(stored, "plane:acme:webhook_secret"));
});

test("A tampered ciphertext, IV or tag fails to decrypt", () => {
  const [version, iv, tag, body] = encryptSecret("plane_api_key_123", CONTEXT).split(".");
  assert.throws(() => decryptSecret([version, iv, tag, flipFirstByte(body)].join("."), CONTEXT));
  assert.throws(() => decryptSecret([version, flipFirstByte(iv), tag, body].join("."), CONTEXT));
  assert.throws(() => decryptSecret([version, iv, flipFirstByte(tag), body].join("."), CONTEXT));
});

test("A tag of the wrong length is refused before decrypting", () => {
  const [version, iv, tag, body] = encryptSecret("plane_api_key_123", CONTEXT).split(".");
  const shortTag = Buffer.from(tag, "base64url").subarray(0, 12).toString("base64url");
  assert.throws(() => decryptSecret([version, iv, shortTag, body].join("."), CONTEXT), /Unreadable connector secret/);
});

test("Values not in the v1 format are refused", () => {
  const [, iv, tag, body] = encryptSecret("x", CONTEXT).split(".");
  for (const stored of ["", "plaintext", "v1.a.b", `v2.${iv}.${tag}.${body}`, `v1..${tag}.${body}`, `v1.${iv}..${body}`]) {
    assert.throws(() => decryptSecret(stored, CONTEXT), /Unreadable connector secret/, stored);
  }
});

test("A secret encrypted under another key fails to decrypt", () => {
  const stored = encryptSecret("plane_api_key_123", CONTEXT);
  withKey(randomBytes(32).toString("base64"), () => {
    assert.throws(() => decryptSecret(stored, CONTEXT));
  });
});

test("Encryption needs a 32-byte base64 key", () => {
  assert.equal(encryptionConfigured(), true);
  withKey(undefined, () => {
    assert.equal(encryptionConfigured(), false);
    assert.throws(() => encryptSecret("x", CONTEXT), /CONNECTOR_ENCRYPTION_KEY is not set/);
  });
  withKey(randomBytes(16).toString("base64"), () => {
    assert.equal(encryptionConfigured(), false);
    assert.throws(() => encryptSecret("x", CONTEXT), /must be 32 bytes/);
  });
});

test("Only Slack and Plane are stored providers", () => {
  assert.equal(isProvider("slack"), true);
  assert.equal(isProvider("plane"), true);
  assert.equal(isProvider("github"), false);
});
