import type { Batch, PersonRef, Sensitivity } from "../types";

export type SlackUser = {
  id: string;
  name: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { display_name?: string; real_name?: string; email?: string };
};

export type SlackChannel = {
  id: string;
  name: string;
  is_private?: boolean;
  is_member?: boolean;
  is_archived?: boolean;
};

export type SlackMessage = {
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  subtype?: string;
  reply_count?: number;
  edited?: { ts: string };
};

export type ChannelScope = { id: string; name: string; sensitivity: Sensitivity; visible_to?: PersonRef[] };

const SLACKBOT = "USLACKBOT";
const KEPT_SUBTYPES = new Set([undefined, "thread_broadcast", "file_share", "me_message"]);
const TITLE_LENGTH = 60;

export function slackRef(userId: string): PersonRef {
  return { connector: "slack", external_id: userId };
}

export function messageExternalId(channelId: string, ts: string): string {
  return `${channelId}:${ts}`;
}

export function isHuman(user: SlackUser): boolean {
  return !user.is_bot && !user.deleted && user.id !== SLACKBOT;
}

export function userToPerson(user: SlackUser): PersonRef {
  return {
    connector: "slack",
    external_id: user.id,
    name: user.real_name || user.profile?.real_name || user.name,
    handle: user.profile?.display_name || user.name,
    email: user.profile?.email?.toLowerCase() || undefined,
  };
}

export function channelScope(channel: SlackChannel, members?: string[]): ChannelScope {
  return channel.is_private
    ? { id: channel.id, name: channel.name, sensitivity: "restricted", visible_to: (members ?? []).map(slackRef) }
    : { id: channel.id, name: channel.name, sensitivity: "team" };
}

export function isConversationMessage(message: SlackMessage): boolean {
  return KEPT_SUBTYPES.has(message.subtype) && Boolean(message.user) && Boolean(message.text?.trim());
}

function tsToIso(ts: string): string {
  return new Date(Number(ts) * 1000).toISOString();
}

function permalink(teamUrl: string, channelId: string, message: SlackMessage): string {
  const base = `${teamUrl.replace(/\/$/, "")}/archives/${channelId}/p${message.ts.replace(".", "")}`;
  return isReply(message) ? `${base}?thread_ts=${message.thread_ts}&cid=${channelId}` : base;
}

function isReply(message: SlackMessage): boolean {
  return Boolean(message.thread_ts) && message.thread_ts !== message.ts;
}

function titleOf(channelName: string, text: string): string {
  const firstLine = text.split("\n")[0].trim();
  const short = firstLine.length <= TITLE_LENGTH ? firstLine : `${firstLine.slice(0, TITLE_LENGTH - 3).trimEnd()}...`;
  return `#${channelName}: ${short}`;
}

function node(kind: "source" | "person", id: string) {
  return { kind, connector: "slack", external_id: id };
}

export function messageBatch(scope: ChannelScope, message: SlackMessage, teamUrl: string, deletedAt?: string): Required<Batch> {
  const batch: Required<Batch> = { sources: [], people: [], projects: [], codeUnits: [], links: [] };
  const text = message.text ?? "";
  const id = messageExternalId(scope.id, message.ts);

  batch.sources.push({
    connector: "slack",
    external_id: id,
    labels: ["Message"],
    url: permalink(teamUrl, scope.id, message),
    title: titleOf(scope.name, text),
    text,
    created_at: tsToIso(message.ts),
    updated_at: message.edited ? tsToIso(message.edited.ts) : undefined,
    deleted_at: deletedAt,
    sensitivity: scope.sensitivity,
    visible_to: scope.visible_to,
    channel: `slack:${scope.id}`,
  });
  if (message.user) {
    batch.people.push(slackRef(message.user));
    batch.links.push({ from: node("person", message.user), rel: "AUTHORED", to: node("source", id) });
  }
  if (isReply(message)) {
    batch.links.push({
      from: node("source", id),
      rel: "PART_OF",
      to: node("source", messageExternalId(scope.id, message.thread_ts!)),
    });
  }
  return batch;
}
