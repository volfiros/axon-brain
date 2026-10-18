import assert from "node:assert/strict";
import { test } from "node:test";

import { slackMessage } from "@/tests/helpers/connector-payloads";

import {
  channelScope,
  isConversationMessage,
  isHuman,
  messageBatch,
  messageExternalId,
  userToPerson,
  type ChannelScope,
} from "./normalize";

const TEAM = "https://acme.slack.test/";
const general: ChannelScope = { id: "C1", name: "general", sensitivity: "team" };

test("Bots, deactivated users and Slackbot are not people", () => {
  assert.equal(isHuman({ id: "U1", name: "ada" }), true);
  assert.equal(isHuman({ id: "B1", name: "deploybot", is_bot: true }), false);
  assert.equal(isHuman({ id: "U2", name: "gone", deleted: true }), false);
  assert.equal(isHuman({ id: "USLACKBOT", name: "slackbot" }), false);
});

test("A user's real name, display name and lowercased email become the Person", () => {
  const person = userToPerson({
    id: "U1",
    name: "ada",
    real_name: "Ada Lovelace",
    profile: { display_name: "ada.l", email: "Ada@Example.TEST" },
  });
  assert.deepEqual(person, {
    connector: "slack",
    external_id: "U1",
    name: "Ada Lovelace",
    handle: "ada.l",
    email: "ada@example.test",
  });
});

test("A user with only a username falls back to it and has no email", () => {
  assert.deepEqual(userToPerson({ id: "U3", name: "grace", profile: { display_name: "", email: "" } }), {
    connector: "slack",
    external_id: "U3",
    name: "grace",
    handle: "grace",
    email: undefined,
  });
  assert.equal(userToPerson({ id: "U4", name: "x", profile: { real_name: "Profile Name" } }).name, "Profile Name");
});

test("A public channel is team-visible and a private one is restricted to its members", () => {
  assert.deepEqual(channelScope({ id: "C1", name: "general" }), { id: "C1", name: "general", sensitivity: "team" });
  assert.deepEqual(channelScope({ id: "G1", name: "secret", is_private: true }, ["U1"]), {
    id: "G1",
    name: "secret",
    sensitivity: "restricted",
    visible_to: [{ connector: "slack", external_id: "U1" }],
  });
  assert.deepEqual(channelScope({ id: "G2", name: "empty", is_private: true }).visible_to, []);
});

test("Plain messages, thread broadcasts, file shares and /me messages are conversation", () => {
  for (const subtype of [undefined, "thread_broadcast", "file_share", "me_message"]) {
    assert.equal(isConversationMessage(slackMessage({ subtype })), true, String(subtype));
  }
});

test("Joins, bot posts, messages without a user and blank messages are not conversation", () => {
  assert.equal(isConversationMessage(slackMessage({ subtype: "channel_join" })), false);
  assert.equal(isConversationMessage(slackMessage({ subtype: "bot_message" })), false);
  assert.equal(isConversationMessage(slackMessage({ user: undefined })), false);
  assert.equal(isConversationMessage(slackMessage({ text: "  \n " })), false);
  assert.equal(isConversationMessage(slackMessage({ text: undefined })), false);
});

test("A top-level message becomes a Message Source with a permalink and an author", () => {
  const batch = messageBatch(general, slackMessage(), TEAM);
  assert.deepEqual(batch.sources, [
    {
      connector: "slack",
      external_id: "C1:1760000000.000100",
      labels: ["Message"],
      url: "https://acme.slack.test/archives/C1/p1760000000000100",
      title: "#general: We decided to drop the v1 API",
      text: "We decided to drop the v1 API",
      created_at: new Date(1760000000000.1).toISOString(),
      updated_at: undefined,
      deleted_at: undefined,
      sensitivity: "team",
      visible_to: undefined,
    },
  ]);
  assert.deepEqual(batch.people, [{ connector: "slack", external_id: "U1" }]);
  assert.deepEqual(batch.links, [
    {
      from: { kind: "person", connector: "slack", external_id: "U1" },
      rel: "AUTHORED",
      to: { kind: "source", connector: "slack", external_id: "C1:1760000000.000100" },
    },
  ]);
});

test("A thread reply links to its parent and its permalink names the thread", () => {
  const reply = slackMessage({ ts: "1760000100.000200", thread_ts: "1760000000.000100", text: "Agreed" });
  const batch = messageBatch(general, reply, TEAM);
  assert.equal(
    batch.sources[0].url,
    "https://acme.slack.test/archives/C1/p1760000100000200?thread_ts=1760000000.000100&cid=C1",
  );
  assert.deepEqual(batch.links.at(-1), {
    from: { kind: "source", connector: "slack", external_id: "C1:1760000100.000200" },
    rel: "PART_OF",
    to: { kind: "source", connector: "slack", external_id: messageExternalId("C1", "1760000000.000100") },
  });
});

test("A thread parent, whose thread_ts is its own ts, is not part of anything", () => {
  const parent = slackMessage({ thread_ts: "1760000000.000100", reply_count: 2 });
  assert.deepEqual(
    messageBatch(general, parent, TEAM).links.map((l) => l.rel),
    ["AUTHORED"],
  );
});

test("Long titles use the first line, cut to sixty characters", () => {
  const text = `${"a".repeat(80)}\nsecond line`;
  const title = messageBatch(general, slackMessage({ text }), TEAM).sources[0].title;
  assert.equal(title, `#general: ${"a".repeat(57)}...`);
});

test("An edited message carries its edit time and a deleted one its deletion time", () => {
  const edited = messageBatch(general, slackMessage({ edited: { ts: "1760000500.000000" } }), TEAM, "2026-10-10T00:00:00Z");
  assert.equal(edited.sources[0].updated_at, new Date(1760000500000).toISOString());
  assert.equal(edited.sources[0].deleted_at, "2026-10-10T00:00:00Z");
});

test("Messages in a private channel carry the channel's members", () => {
  const scope = channelScope({ id: "G1", name: "secret", is_private: true }, ["U1", "U2"]);
  const source = messageBatch(scope, slackMessage(), TEAM).sources[0];
  assert.equal(source.sensitivity, "restricted");
  assert.deepEqual(
    source.visible_to?.map((p) => p.external_id),
    ["U1", "U2"],
  );
});
