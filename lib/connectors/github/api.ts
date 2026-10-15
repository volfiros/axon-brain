import { createSign } from "node:crypto";

const API = "https://api.github.com";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function appJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat is backdated a minute because GitHub rejects tokens issued "in the future" on clock drift.
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: requireEnv("GITHUB_APP_ID") }));
  // Vercel and .env store the PEM on one line with literal \n.
  const key = requireEnv("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(key);
  return `${header}.${payload}.${base64url(signature)}`;
}

async function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "axon-brain",
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path} failed with ${res.status}`);
  return res;
}

export type Installation = { id: number; account: { login: string } };

/** Fails unless the installation belongs to this GitHub App. */
export async function getInstallation(installationId: number): Promise<Installation> {
  return (await request(appJwt(), `/app/installations/${installationId}`)).json();
}

export async function installationToken(installationId: number): Promise<string> {
  const res = await request(appJwt(), `/app/installations/${installationId}/access_tokens`, { method: "POST" });
  return ((await res.json()) as { token: string }).token;
}

export async function ghGet<T>(token: string, path: string): Promise<T> {
  return (await request(token, path)).json();
}

export async function* ghPages<T>(token: string, path: string): AsyncIterable<T> {
  let next: string | null = `${path}${path.includes("?") ? "&" : "?"}per_page=100`;
  while (next) {
    const res = await request(token, next);
    const body = (await res.json()) as T[] | { repositories: T[] };
    yield* Array.isArray(body) ? body : body.repositories;
    next = res.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
}

export async function ghAll<T>(token: string, path: string): Promise<T[]> {
  const items: T[] = [];
  for await (const item of ghPages<T>(token, path)) items.push(item);
  return items;
}
