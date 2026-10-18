export type FindingKind = "secret" | "email" | "phone" | "path" | "code" | "length";

export type Finding = {
  field: string;
  kind: FindingKind;
  detail: string;
};

export type Redacted<T> = {
  value: T;
  masked: Finding[];
  rejected: Finding[];
};

export const MAX_EXCERPT_LENGTH = 300;
export const MAX_FIELD_LENGTH = 500;

const SECRET_PATTERNS: [name: string, pattern: RegExp][] = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ["Slack token", /\b(?:xox[abposr]|xapp)-[A-Za-z0-9-]{10,}/],
  ["Hugging Face token", /\bhf_[A-Za-z0-9]{20,}/],
  ["Stripe key", /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["API key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["credentials in a URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:[^\s@/]+@/i],
  ["environment secret", /\b[A-Z][A-Z0-9_]*_(?:KEY|SECRET|TOKEN|PASSWORD)\s*=\s*\S+/],
  ["authorization header", /\bAuthorization\s*:\s*(?:[A-Za-z]+\s+)?\S{6,}/i],
];

const BEARER = /\b(?:Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{8,})/gi;
const ASSIGNMENT =
  /\b(?:api[_-]?key|apikey|secret|token|passw(?:or)?d|pwd|access[_-]?key|client[_-]?secret)\b["']?\s*([:=])\s*(["']?)([^\s"',;]+)\2([^\n]?)/gi;
// Split on - _ . so UUIDs and kebab-case names are not read as one long token.
const LONG_TOKEN = /[A-Za-z0-9+/=]{24,}/g;
const HEX_DIGEST = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const FILE_EXTENSIONS = /^(?:png|jpe?g|gif|svg|webp|ico|pdf|md|txt|json|ya?ml|js|ts|tsx|jsx|css|html?)$/i;
const PHONE_WORDS = /\b(?:phone|mobile|cell|call|tel|whatsapp|sms|text me)\b/i;

const MASKS: [kind: FindingKind, placeholder: string, pattern: RegExp][] = [
  ["email", "[email]", /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+([A-Za-z]{2,})\b/g],
  ["phone", "[phone]", /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,5}){2,4}\b/g],
  ["phone", "[phone]", /\(\d{3}\)\s?\d{3}[\s.-]?\d{4}\b/g],
  ["phone", "[phone]", /\b\d{3}[.-]\d{3}[.-]\d{4}\b/g],
  ["phone", "[phone]", /\b[6-9]\d{4}[\s-]\d{5}\b/g],
  ["path", "[path]", /(?<![\w.:/@-])(?:\/Users|\/home|\/root|\/private\/var|\/var\/folders)\/[^\s"'`),;]*/g],
  ["path", "[path]", /\b[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s"'`),;]*/gi],
  ["path", "[path]", /(?<![\w/])~\/[^\s"'`),;]*/g],
];

function findSecret(text: string): string | undefined {
  for (const [name, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  for (const [, token] of text.matchAll(BEARER)) {
    if (token.length >= 16 || /\d/.test(token)) return "bearer token";
  }
  for (const [, operator, quote, value, after] of text.matchAll(ASSIGNMENT)) {
    // "password: rotated monthly" is prose; a lone value, a quoted one, or `=` is a credential.
    const lone = after === "" || /[,;.\n]/.test(after);
    if (operator === "=" || quote || lone || /[^A-Za-z]/.test(value)) return "secret assignment";
  }
  for (const [token] of text.matchAll(LONG_TOKEN)) {
    if (HEX_DIGEST.test(token)) continue;
    if (/^[0-9a-f]{32,}$/i.test(token) && /\d/.test(token) && /[a-f]/i.test(token)) return "long hex string";
    if (/[A-Za-z]/.test(token) && /\d/.test(token) && entropy(token) >= 4.3) {
      return "long random-looking string";
    }
  }
  return undefined;
}

function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function looksLikeCode(text: string): boolean {
  if (text.includes("```")) return true;
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length > 3) return true;
  if (lines.filter((line) => /[;{}]\s*$/.test(line)).length >= 2) return true;
  return /=>|\)\s*\{|\(\)\s*;|^\s*[{}]|\b(?:const|let|var)\s+\w+\s*=|\b(?:def|function)\s+\w+\(/m.test(text);
}

function maskPhonesWithContext(text: string): string {
  if (!PHONE_WORDS.test(text)) return text;
  return text.replace(/(?<![\d$₹€£.,])\b\d{10,12}\b(?![.,]\d)/g, "[phone]");
}

function redactText(text: string, field: string, isExcerpt: boolean): Redacted<string> {
  const masked: Finding[] = [];
  const rejected: Finding[] = [];
  const limit = isExcerpt ? MAX_EXCERPT_LENGTH : MAX_FIELD_LENGTH;

  const secret = findSecret(text);
  if (secret) rejected.push({ field, kind: "secret", detail: secret });
  if (looksLikeCode(text)) rejected.push({ field, kind: "code", detail: "looks like code or file contents" });
  if (text.length > limit) rejected.push({ field, kind: "length", detail: `longer than ${limit} characters` });

  let value = text;
  for (const [kind, placeholder, pattern] of MASKS) {
    const next = value.replace(pattern, (match, tld?: string) =>
      kind === "email" && FILE_EXTENSIONS.test(tld ?? "") ? match : placeholder,
    );
    if (next !== value) {
      masked.push({ field, kind, detail: `masked as ${placeholder}` });
      value = next;
    }
  }
  const withPhones = maskPhonesWithContext(value);
  if (withPhones !== value) {
    masked.push({ field, kind: "phone", detail: "masked as [phone]" });
    value = withPhones;
  }
  return { value, masked, rejected };
}

function walk(value: unknown, field: string, inExcerpts: boolean): Redacted<unknown> {
  if (typeof value === "string") return redactText(value, field, inExcerpts);
  if (Array.isArray(value)) {
    const results = value.map((entry, i) => walk(entry, `${field}[${i}]`, inExcerpts));
    return {
      value: results.map((r) => r.value),
      masked: results.flatMap((r) => r.masked),
      rejected: results.flatMap((r) => r.rejected),
    };
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const masked: Finding[] = [];
    const rejected: Finding[] = [];
    for (const [key, entry] of Object.entries(value)) {
      const r = walk(entry, field ? `${field}.${key}` : key, inExcerpts || key === "excerpts");
      out[key] = r.value;
      masked.push(...r.masked);
      rejected.push(...r.rejected);
    }
    return { value: out, masked, rejected };
  }
  return { value, masked: [], rejected: [] };
}

/**
 * Scans every string field of a distilled session item. Emails, phone numbers and local paths
 * are masked in the returned copy. Secrets, code, and text over the length cap (300 characters
 * for excerpts, 500 for other fields) are reported in `rejected`: the caller must drop the item
 * rather than store a masked version. Findings name the field and the kind of match, never the matched text.
 */
export function redactItem<T>(item: T): Redacted<T> {
  const result = walk(item, "", false);
  return { value: result.value as T, masked: result.masked, rejected: result.rejected };
}
