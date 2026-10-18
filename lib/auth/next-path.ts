// Only same-origin relative paths: "/\evil.com" and "//evil.com" both resolve to another origin and are rejected.
export function safeNextPath(next: string | null | undefined, fallback = "/onboarding"): string {
  if (!next || !/^\/(?![/\\])/.test(next)) return fallback;
  const base = "http://axon.local";
  const url = new URL(next, base);
  // Dot segments can collapse "/.//evil.com" into "//evil.com", which a browser reads as another host.
  if (url.origin !== base || /^\/[/\\]/.test(url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
