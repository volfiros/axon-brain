const STOPWORDS = new Set(
  "a an and are about any can did find give list provide show tell do does for from get gets got had has have how into is it its not of on or our should that the their this to was we were what when where which who why will with would you your".split(
    " ",
  ),
);

export type SearchTerms = {
  /** Full-text query for db.idx.fulltext.queryNodes: terms joined with OR. */
  fulltext: string;
  /** Lowercase word stems for CONTAINS matches on names and paths. */
  stems: string[];
};

export function searchTerms(text: string): SearchTerms {
  const words = [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
    ),
  ];
  return {
    fulltext: words.join("|"),
    stems: words.map(stem),
  };
}

// Crude suffix stripping so "approved" matches "approval" and "refunds" matches "refund" in CONTAINS checks.
function stem(word: string): string {
  for (const suffix of ["ing", "ed", "al", "es", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}

// The falkordb client returns localdatetime values as Temporal.PlainDateTime, which prints as ISO 8601.
export function day(value: unknown): string {
  return value == null ? "unknown date" : String(value).slice(0, 10);
}
