import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(__dirname, "..", "demo", "connectors");

type Delivery = { name: string; url: string; body: string; headers: Record<string, string>; expect: number };

function fixtureBodies(dir: string): { name: string; body: string }[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({ name: file, body: JSON.stringify(JSON.parse(readFileSync(join(dir, file), "utf8"))) }));
}

function planeHeaders(body: string, secret: string): Record<string, string> {
  const event = (JSON.parse(body) as { event?: string }).event ?? "";
  return { "X-Plane-Event": event, "X-Plane-Signature": createHmac("sha256", secret).update(body).digest("hex") };
}

function slackHeaders(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): Record<string, string> {
  const signature = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
  return { "X-Slack-Request-Timestamp": String(timestamp), "X-Slack-Signature": `v0=${signature}` };
}

async function main() {
  const base = process.env.REPLAY_BASE_URL ?? "http://localhost:3000";
  const workspace = process.env.CONNECTORS_WORKSPACE ?? "demo";
  const planeSecret = process.env.PLANE_WEBHOOK_SECRET;
  const slackSecret = process.env.SLACK_SIGNING_SECRET;
  if (!planeSecret || !slackSecret) throw new Error("Set PLANE_WEBHOOK_SECRET and SLACK_SIGNING_SECRET to the values the server uses.");

  const planeUrl = `${base}/api/w/${workspace}/plane/webhook`;
  const slackUrl = `${base}/api/w/${workspace}/slack/events`;
  const plane = fixtureBodies(join(FIXTURES, "plane", "webhooks"));
  const slack = fixtureBodies(join(FIXTURES, "slack", "events"));

  const deliveries: Delivery[] = [
    ...plane.map(({ name, body }) => ({ name: `plane ${name}`, url: planeUrl, body, headers: planeHeaders(body, planeSecret), expect: 200 })),
    ...slack.map(({ name, body }) => ({ name: `slack ${name}`, url: slackUrl, body, headers: slackHeaders(body, slackSecret), expect: 200 })),
    { name: "plane wrong secret", url: planeUrl, body: plane[0].body, headers: planeHeaders(plane[0].body, "wrong-secret"), expect: 401 },
    { name: "slack wrong secret", url: slackUrl, body: slack[1].body, headers: slackHeaders(slack[1].body, "wrong-secret"), expect: 401 },
    {
      name: "slack stale timestamp",
      url: slackUrl,
      body: slack[1].body,
      headers: slackHeaders(slack[1].body, slackSecret, Math.floor(Date.now() / 1000) - 600),
      expect: 401,
    },
    { name: "plane other workspace", url: `${base}/api/w/not-${workspace}/plane/webhook`, body: plane[0].body, headers: planeHeaders(plane[0].body, planeSecret), expect: 404 },
  ];

  let failures = 0;
  for (const delivery of deliveries) {
    const res = await fetch(delivery.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...delivery.headers },
      body: delivery.body,
    });
    const text = await res.text();
    const ok = res.status === delivery.expect;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${res.status} (expected ${delivery.expect}) ${delivery.name}${text ? ` ${text}` : ""}`);
    // Each event is written after the response, so give it a moment before the next one depends on it.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
