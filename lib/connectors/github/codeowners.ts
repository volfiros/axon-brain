export const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

type Rule = { pattern: RegExp; owners: string[] };

function patternToRegex(raw: string): RegExp {
  const anchored = raw.startsWith("/") || raw.slice(0, -1).includes("/");
  const dirOnly = raw.endsWith("/");
  const glob = raw.replace(/^\//, "").replace(/\/$/, "");
  let body = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      body += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") {
      body += "[^/]*";
    } else if (c === "?") {
      body += "[^/]";
    } else {
      body += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  const start = anchored ? "^" : "^(?:.*/)?";
  // GitHub: "docs/*" covers files directly in docs/ only, while "docs" or "docs/" covers everything below.
  const end = dirOnly ? "/.*$" : glob.endsWith("/*") ? "$" : "(?:/.*)?$";
  return new RegExp(start + body + end);
}

/** Parses CODEOWNERS into rules. Only `@user` owners are kept: team and email owners have no GitHub login to match. */
export function parseCodeowners(text: string): Rule[] {
  return text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return {
        pattern: patternToRegex(pattern),
        owners: owners.filter((o) => /^@[^/]+$/.test(o)).map((o) => o.slice(1)),
      };
    });
}

/** The last matching rule wins, as on GitHub. */
export function ownersOf(rules: Rule[], path: string): string[] {
  for (let i = rules.length - 1; i >= 0; i--) {
    if (rules[i].pattern.test(path)) return rules[i].owners;
  }
  return [];
}
