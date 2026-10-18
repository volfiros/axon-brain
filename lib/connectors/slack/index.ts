import { createHmac, timingSafeEqual } from "node:crypto";

import type { Batch, Connector, ConnectorContext, SourceInput } from "../types";
import { httpSlackApi, paginate, type SlackApi } from "./api";
import {
  channelScope,
  isConversationMessage,
  isHuman,
  messageBatch,
  slackRef,
  userToPerson,
  type ChannelScope,
  type SlackChannel,
  type SlackMessage,
  type SlackUser,
} from "./normalize";

type SlackEvent = {
  type: string;
  subtype?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  ts?: string;
  text?: string;
  thread_ts?: string;
  message?: SlackMessage;
  previous_message?: SlackMessage;
  deleted_ts?: string;
};

export type SlackEnvelope = { type?: string; event?: SlackEvent };

type ChannelInfo = { scope: ChannelScope; teamUrl: string };

const MAX_SKEW_SECONDS = 300;
const DIRECT_MESSAGE_TYPES = new Set(["im", "mpim"]);
const PRIVATE_CHANNEL_TYPES = new Set(["group", "G"]);
const FALLBACK_TEAM_URL = "https://slack.com";

export function slackConfig() {
  return {
    botToken: process.env.SLACK_BOT_TOKEN || "",
    signingSecret: process.env.SLACK_SIGNING_SECRET || "",
  };
}

function epochSeconds(iso: string | undefined): string | undefined {
  return iso ? String(Date.parse(iso) / 1000) : undefined;
}

export async function* backfillWith(api: SlackApi, ctx: ConnectorContext): AsyncIterable<Batch> {
  const { url: teamUrl } = await api.call<{ url: string }>("auth.test");

  const users = await collect(paginate<SlackUser>(api, "users.list", "members"));
  // Bots get a name so their messages show an author, but never count as channel members.
  yield { people: users.filter((user) => isHuman(user) || (user.is_bot && !user.deleted)).map(userToPerson) };
  const humans = new Set(users.filter(isHuman).map((user) => user.id));

  const oldest = epochSeconds(ctx.since);
  const stored = oldest ? await storedChannels(ctx) : new Set<string>();
  const channels = paginate<SlackChannel>(api, "conversations.list", "channels", {
    types: "public_channel,private_channel",
    exclude_archived: "true",
  });
  for await (const channel of channels) {
    // The bot can only read history in channels it has been added to.
    if (!channel.is_member || channel.is_archived) continue;
    const members = channel.is_private
      ? (await collect(paginate<string>(api, "conversations.members", "members", { channel: channel.id }))).filter((id) =>
          humans.has(id),
        )
      : undefined;
    const scope = channelScope(channel, members);

    // The resume point is the last sync, so a channel the bot joined after it has no stored messages and is read in full.
    const from = oldest && stored.has(channel.id) ? oldest : undefined;
    const history = paginate<SlackMessage>(api, "conversations.history", "messages", {
      channel: channel.id,
      ...(from ? { oldest: from } : {}),
    });
    for await (const message of history) {
      if (isConversationMessage(message)) yield messageBatch(scope, message, teamUrl);
      if (!message.reply_count) continue;
      const replies = paginate<SlackMessage>(api, "conversations.replies", "messages", { channel: channel.id, ts: message.ts });
      for await (const reply of replies) {
        if (reply.ts !== message.ts && isConversationMessage(reply)) yield messageBatch(scope, reply, teamUrl);
      }
    }
  }
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
}

async function storedChannels(ctx: ConnectorContext): Promise<Set<string>> {
  const rows = await ctx.graph.roQuery<{ channel: string }>(
    "MATCH (s:Source) WHERE s.id STARTS WITH 'slack:' RETURN DISTINCT split(s.id, ':')[1] AS channel",
  );
  return new Set(rows.map((r) => r.channel));
}

type ChannelRow = { title: string; url: string; sensitivity: string; ids: string[][] };

async function knownChannel(ctx: ConnectorContext, channelId: string): Promise<ChannelInfo | null> {
  const [row] = await ctx.graph.roQuery<ChannelRow>(
    `MATCH (s:Source) WHERE s.id STARTS WITH $prefix
     WITH s ORDER BY s.created_at DESC LIMIT 1
     OPTIONAL MATCH (s)-[:VISIBLE_TO]->(x:Person)
     RETURN s.title AS title, s.url AS url, s.sensitivity AS sensitivity, collect(x.external_ids) AS ids`,
    { prefix: `slack:${channelId}:` },
  );
  if (!row) return null;
  const name = /^#([^:]+):/.exec(row.title)?.[1] ?? channelId;
  const teamUrl = row.url.split("/archives/")[0];
  if (row.sensitivity !== "restricted") return { scope: { id: channelId, name, sensitivity: "team" }, teamUrl };
  const members = row.ids
    .flat()
    .filter((key) => key.startsWith("slack:"))
    .map((key) => key.slice("slack:".length));
  return { scope: { id: channelId, name, sensitivity: "restricted", visible_to: members.map(slackRef) }, teamUrl };
}

// Channels Axon has not seen yet are read from Slack when a token is set. Without one, a private channel stays Admin-only.
async function lookupChannel(ctx: ConnectorContext, channelId: string, channelType?: string): Promise<ChannelInfo> {
  const known = await knownChannel(ctx, channelId);
  if (known) return known;
  const token = ctx.token ?? slackConfig().botToken;
  if (token) {
    const api = httpSlackApi(token);
    const { url, user_id: botId } = await api.call<{ url: string; user_id: string }>("auth.test");
    const { channel } = await api.call<{ channel: SlackChannel }>("conversations.info", { channel: channelId });
    const members = channel.is_private
      ? (await collect(paginate<string>(api, "conversations.members", "members", { channel: channelId }))).filter(
          (id) => id !== botId,
        )
      : undefined;
    return { scope: channelScope(channel, members), teamUrl: url };
  }
  const isPrivate = PRIVATE_CHANNEL_TYPES.has(channelType ?? "");
  return {
    scope: isPrivate
      ? { id: channelId, name: channelId, sensitivity: "restricted", visible_to: [] }
      : { id: channelId, name: channelId, sensitivity: "team" },
    teamUrl: FALLBACK_TEAM_URL,
  };
}

type StoredMessage = {
  external_id: string;
  title: string;
  text: string;
  url: string;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

function storedTime(value: unknown): string | undefined {
  return value ? `${String(value)}Z` : undefined;
}

// Only accounts already synced from users.list count, which keeps unknown accounts out of the graph.
async function isSyncedPerson(ctx: ConnectorContext, userId: string): Promise<boolean> {
  const rows = await ctx.graph.roQuery("MATCH (p:Person) WHERE $key IN p.external_ids RETURN p.id", {
    key: `slack:${userId}`,
  });
  return rows.length > 0;
}

async function membershipBatch(ctx: ConnectorContext, event: SlackEvent): Promise<Batch | null> {
  if (!event.channel || !event.user) return null;
  const known = await knownChannel(ctx, event.channel);
  if (!known || known.scope.sensitivity !== "restricted") return null;

  const members = new Set((known.scope.visible_to ?? []).map((ref) => ref.external_id));
  if (event.type === "member_joined_channel") {
    if (!(await isSyncedPerson(ctx, event.user))) return null;
    members.add(event.user);
  } else {
    members.delete(event.user);
  }

  const rows = await ctx.graph.roQuery<StoredMessage>(
    `MATCH (s:Source) WHERE s.id STARTS WITH $prefix
     RETURN s.external_id AS external_id, s.title AS title, s.text AS text, s.url AS url,
            s.created_at AS created_at, s.updated_at AS updated_at, s.deleted_at AS deleted_at`,
    { prefix: `slack:${event.channel}:` },
  );
  const sources = rows.map(
    (row): SourceInput => ({
      connector: "slack",
      external_id: row.external_id,
      labels: ["Message"],
      url: row.url,
      title: row.title,
      text: row.text,
      created_at: storedTime(row.created_at)!,
      updated_at: storedTime(row.updated_at),
      deleted_at: storedTime(row.deleted_at),
      sensitivity: "restricted",
      visible_to: [...members].map(slackRef),
    }),
  );
  return { sources };
}

export async function* slackEventBatches(envelope: SlackEnvelope, ctx: ConnectorContext): AsyncIterable<Batch> {
  const event = envelope.event;
  if (envelope.type !== "event_callback" || !event?.channel) return;
  if (DIRECT_MESSAGE_TYPES.has(event.channel_type ?? "")) return;

  if (event.type === "member_joined_channel" || event.type === "member_left_channel") {
    const batch = await membershipBatch(ctx, event);
    if (batch) yield batch;
    return;
  }
  if (event.type !== "message") return;

  const deleted = event.subtype === "message_deleted";
  const message =
    event.subtype === "message_changed"
      ? event.message
      : deleted
        ? event.previous_message
        : { ts: event.ts!, user: event.user, text: event.text, thread_ts: event.thread_ts, subtype: event.subtype };
  if (!message?.ts || !message.user || !isConversationMessage(message)) return;
  if (!(await isSyncedPerson(ctx, message.user))) return;

  const { scope, teamUrl } = await lookupChannel(ctx, event.channel, event.channel_type);
  yield messageBatch(scope, message, teamUrl, deleted ? new Date().toISOString() : undefined);
}

export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  now = Date.now(),
): boolean {
  if (!secret || !timestamp || !signature) return false;
  // Slack's replay protection: reject anything signed more than five minutes ago.
  const signedAt = Number(timestamp);
  if (!Number.isFinite(signedAt) || Math.abs(now / 1000 - signedAt) > MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`);
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const slackConnector: Connector<SlackEnvelope> = {
  name: "slack",
  backfill(ctx) {
    return backfillWith(httpSlackApi(ctx.token ?? slackConfig().botToken), ctx);
  },
  verifyWebhook(req, rawBody) {
    return verifySlackSignature(
      rawBody,
      req.headers.get("X-Slack-Request-Timestamp"),
      req.headers.get("X-Slack-Signature"),
      slackConfig().signingSecret,
    );
  },
  eventToBatches(_headers, payload, ctx) {
    return slackEventBatches(payload, ctx);
  },
};
