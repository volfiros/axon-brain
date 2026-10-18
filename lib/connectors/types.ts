import type { AxonGraph } from "@/lib/graph/client";

export type Sensitivity = "public" | "team" | "restricted";

export type PersonRef = {
  connector: string;
  external_id: string;
  name?: string;
  handle?: string;
  email?: string;
};

export type SourceInput = {
  connector: string;
  external_id: string;
  /** Labels under Source, such as ["PR"], ["Message"] or ["WorkItem"]. */
  labels: string[];
  title: string;
  text: string;
  url?: string;
  /** ISO 8601 timestamps. Stored as UTC localdatetime. */
  created_at: string;
  updated_at?: string;
  deleted_at?: string;
  sensitivity: Sensitivity;
  /** Persons who can see a restricted Source besides the Admin Role. */
  visible_to?: PersonRef[];
  /** false keeps the Source out of the agent's extraction queue (commits, for example). */
  extract?: boolean;
  /** A Plane work item's key, such as "BIL-12". Other Sources refer to it by this key. */
  key?: string;
  /** A pull request's head branch, scanned for work-item keys. */
  branch?: string;
  /** The chat channel a message was posted in, so search can return the conversation around a hit. */
  channel?: string;
};

export type ProjectInput = {
  connector: string;
  external_id: string;
  name: string;
  url?: string;
  sensitivity: Sensitivity;
  /** A Plane project's identifier, the prefix of its work-item keys. */
  key?: string;
};

export type CodeUnitInput = {
  repo: string;
  /** "/" for the repository itself. */
  path: string;
  kind: "repository" | "file";
};

export type NodeRef =
  | { kind: "source" | "person" | "project"; connector: string; external_id: string }
  | { kind: "codeunit"; repo: string; path: string };

export type LinkRel = "ATTENDED" | "AUTHORED" | "OWNS" | "PART_OF" | "TOUCHES";

export type LinkInput = {
  from: NodeRef;
  rel: LinkRel;
  to: NodeRef;
  props?: Record<string, string | number | boolean>;
};

export type Batch = {
  sources?: SourceInput[];
  people?: PersonRef[];
  projects?: ProjectInput[];
  codeUnits?: CodeUnitInput[];
  links?: LinkInput[];
};

export type ConnectorContext = {
  workspace: string;
  graph: AxonGraph;
  token?: string;
  since?: string;
};

export type Connector<Payload = unknown> = {
  name: string;
  backfill(ctx: ConnectorContext): AsyncIterable<Batch>;
  verifyWebhook(req: Request, rawBody: string): boolean;
  eventToBatches(headers: Headers, payload: Payload, ctx: ConnectorContext): AsyncIterable<Batch>;
};
