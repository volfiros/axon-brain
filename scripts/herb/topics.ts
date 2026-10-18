import { closeConnection, workspaceGraph } from "@/lib/graph/client";

import { llm } from "./answer";
import { assertLocal, herbProducts, herbSlug, readProduct } from "./load";

// Plays the team's agent: it reads the planning meetings and PR titles once and proposes which feature each PR builds.
async function linkProduct(product: string) {
  const p = readProduct(product);
  const meetings = p.meeting_transcripts
    .filter((m) => m.document_type === "product-planning" || m.id.startsWith("product_dev"))
    .map((m) => m.transcript.slice(0, 6000))
    .join("\n---\n")
    .slice(0, 30000);
  const prs = p.prs.map((pr) => `${pr.link} ${pr.title}`).join("\n");
  const reply = await llm(`These are planning meetings and pull requests of the ${product} team.
List the features (the tasks the meetings plan, such as "integrating predictive analytics") and, for each, the links of the pull requests that implement it.
Reply with JSON only: [{"feature": "...", "prs": ["https://github.com/..."]}]

Meetings:
${meetings}

Pull requests:
${prs}`);
  const json = reply.match(/\[[\s\S]*\]/)?.[0] ?? "[]";
  const features = JSON.parse(json) as { feature: string; prs: string[] }[];
  const rows = features.flatMap((f) =>
    f.prs.map((link) => ({ topic: `herb:${product}:${f.feature.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: f.feature, pr: `github:${new URL(link).pathname.split("/").filter(Boolean).slice(0, 4).join("/")}` })),
  );
  const graph = workspaceGraph(herbSlug(product));
  await graph.query("MATCH (:PR)-[r:ABOUT]->(:Topic) DELETE r");
  await graph.query(
    `UNWIND $rows AS r
     MATCH (s:PR:Source {id: r.pr})
     MERGE (t:Topic {id: r.topic}) SET t.name = r.name
     MERGE (s)-[:ABOUT]->(t)`,
    { rows },
  );
  return { features: features.length, links: rows.length };
}

async function main() {
  assertLocal();
  await Promise.all(
    herbProducts().map((product) =>
      linkProduct(product).then(
        (linked) => console.log(product, JSON.stringify(linked)),
        (err) => console.log(product, "failed", err instanceof Error ? err.message : err),
      ),
    ),
  );
  await closeConnection();
}

main();
