import assert from "node:assert/strict";
import { test } from "node:test";

import { planeProject, planeWorkItem } from "@/tests/helpers/connector-payloads";

import {
  commentBatch,
  htmlToText,
  isSecret,
  memberToPerson,
  pageBatch,
  projectBatch,
  scopeOf,
  workItemBatch,
  type PlaneComment,
  type PlanePage,
  type ProjectScope,
} from "./normalize";

const links = { appUrl: "https://plane.example.test", workspaceSlug: "acme" };
const teamScope: ProjectScope = { id: "proj-1", sensitivity: "team", key: "BIL" };

function node(kind: "source" | "person" | "project", id: string) {
  return { kind, connector: "plane", external_id: id };
}

test("HTML becomes plain text with line breaks and decoded entities", () => {
  assert.equal(htmlToText("<p>Hello&nbsp;<b>world</b></p><p>Line&lt;2&gt;</p>"), "Hello world\nLine<2>");
  assert.equal(htmlToText("a<br>b<br/>c"), "a\nb\nc");
  assert.equal(htmlToText("<ul><li>one</li><li>two</li></ul>"), "one\ntwo");
  assert.equal(htmlToText("&quot;x&quot; &#39;y&#39; &amp;"), `"x" 'y' &`);
});

test("An escaped entity is decoded only once", () => {
  assert.equal(htmlToText("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
});

test("Runs of blank lines collapse and trailing spaces before a newline are removed", () => {
  assert.equal(htmlToText("<p>a   </p><p></p><p></p><p></p><p>b</p>"), "a\n\nb");
  assert.equal(htmlToText(""), "");
});

test("A member becomes a Person keyed by their user id, with a lowercased email", () => {
  assert.deepEqual(
    memberToPerson({ id: "wm-1", member: "user-1", first_name: "Ada", last_name: "Lovelace", display_name: "ada", email: "Ada@Example.TEST" }),
    { connector: "plane", external_id: "user-1", name: "Ada Lovelace", handle: "ada", email: "ada@example.test" },
  );
});

test("A member without a name falls back to the display name, then to nothing", () => {
  assert.deepEqual(memberToPerson({ id: "user-2", display_name: "grace" }), {
    connector: "plane",
    external_id: "user-2",
    name: "grace",
    handle: "grace",
    email: undefined,
  });
  assert.deepEqual(memberToPerson({ id: "user-3", email: "" }), {
    connector: "plane",
    external_id: "user-3",
    name: undefined,
    handle: undefined,
    email: undefined,
  });
});

test("Only a project explicitly marked public is not secret", () => {
  assert.equal(isSecret(planeProject({ network: 2 })), false);
  assert.equal(isSecret(planeProject({ network: 0 })), true);
  assert.equal(isSecret(planeProject({ network: undefined })), true);
});

test("A public project's scope is team-wide and a secret one is restricted to the given members", () => {
  assert.deepEqual(scopeOf(planeProject()), { id: "proj-1", sensitivity: "team", key: "BIL" });
  assert.deepEqual(scopeOf(planeProject({ network: 0 }), [{ connector: "plane", external_id: "user-1" }]), {
    id: "proj-1",
    sensitivity: "restricted",
    visible_to: [{ connector: "plane", external_id: "user-1" }],
    key: "BIL",
  });
  assert.deepEqual(scopeOf(planeProject({ network: 0 })).visible_to, []);
});

test("A project becomes a Project owned by its lead", () => {
  const batch = projectBatch(planeProject(), links);
  assert.deepEqual(batch.projects, [
    {
      connector: "plane",
      external_id: "proj-1",
      name: "Billing",
      url: "https://plane.example.test/acme/projects/proj-1/issues/",
      sensitivity: "team",
      key: "BIL",
    },
  ]);
  assert.deepEqual(batch.people, [{ connector: "plane", external_id: "lead-1" }]);
  assert.deepEqual(batch.links, [{ from: node("person", "lead-1"), rel: "OWNS", to: node("project", "proj-1") }]);
});

test("A secret project without a lead is restricted and has no owner", () => {
  const batch = projectBatch(planeProject({ network: 0, project_lead: null }), links);
  assert.equal(batch.projects[0].sensitivity, "restricted");
  assert.deepEqual(batch.people, []);
  assert.deepEqual(batch.links, []);
});

test("A work item becomes a keyed WorkItem in its project, authored by its creator and owned by its assignees", () => {
  const batch = workItemBatch(teamScope, planeWorkItem({ assignees: ["member-2", { id: "member-3" }] }), links);
  assert.deepEqual(batch.sources, [
    {
      connector: "plane",
      external_id: "item-1",
      labels: ["WorkItem"],
      url: "https://plane.example.test/acme/projects/proj-1/issues/item-1",
      title: "Refund rounding",
      text: "Refund rounding\n\nRound refunds down to the cent.",
      created_at: "2026-10-01T10:00:00Z",
      updated_at: "2026-10-03T10:00:00Z",
      deleted_at: undefined,
      sensitivity: "team",
      visible_to: undefined,
      key: "BIL-12",
    },
  ]);
  assert.deepEqual(
    batch.people.map((p) => p.external_id),
    ["member-1", "member-2", "member-3"],
  );
  assert.deepEqual(batch.links, [
    { from: node("source", "item-1"), rel: "PART_OF", to: node("project", "proj-1") },
    { from: node("person", "member-1"), rel: "AUTHORED", to: node("source", "item-1") },
    { from: node("person", "member-2"), rel: "OWNS", to: node("source", "item-1") },
    { from: node("person", "member-3"), rel: "OWNS", to: node("source", "item-1") },
  ]);
});

test("A work item without a stripped description uses its HTML, and an empty one is just the name", () => {
  const fromHtml = workItemBatch(teamScope, planeWorkItem({ description_stripped: null, description_html: "<p>From HTML</p>" }), links);
  assert.equal(fromHtml.sources[0].text, "Refund rounding\n\nFrom HTML");
  const empty = workItemBatch(teamScope, planeWorkItem({ description_stripped: "" }), links);
  assert.equal(empty.sources[0].text, "Refund rounding");
});

test("A work item has no key without a project identifier or sequence id", () => {
  assert.equal(workItemBatch({ ...teamScope, key: undefined }, planeWorkItem(), links).sources[0].key, undefined);
  assert.equal(workItemBatch(teamScope, planeWorkItem({ sequence_id: undefined }), links).sources[0].key, undefined);
});

test("A work item with no creator or assignees links only to its project", () => {
  const batch = workItemBatch(teamScope, planeWorkItem({ created_by: null, assignees: undefined }), links);
  assert.deepEqual(batch.people, []);
  assert.deepEqual(
    batch.links.map((l) => l.rel),
    ["PART_OF"],
  );
});

test("A deleted work item in a secret project keeps its deletion time and visibility", () => {
  const scope: ProjectScope = { id: "proj-1", sensitivity: "restricted", visible_to: [{ connector: "plane", external_id: "member-1" }] };
  const source = workItemBatch(scope, planeWorkItem(), links, "2026-10-09T00:00:00Z").sources[0];
  assert.equal(source.deleted_at, "2026-10-09T00:00:00Z");
  assert.equal(source.sensitivity, "restricted");
  assert.deepEqual(source.visible_to, [{ connector: "plane", external_id: "member-1" }]);
});

const comment: PlaneComment = {
  id: "comment-1",
  comment_html: "<p>Should we round up?</p>",
  issue: "item-1",
  actor: "member-2",
  created_by: "member-9",
  created_at: "2026-10-02T10:00:00Z",
};

test("A comment becomes a Message on its work item, authored by its actor", () => {
  const batch = commentBatch(teamScope, comment, "Refund rounding", links);
  const source = batch.sources[0];
  assert.equal(source.external_id, "comment-1");
  assert.deepEqual(source.labels, ["Message"]);
  assert.equal(source.title, "Comment on Refund rounding");
  assert.equal(source.text, "Should we round up?");
  assert.equal(source.url, "https://plane.example.test/acme/projects/proj-1/issues/item-1#comment-comment-1");
  assert.deepEqual(batch.links, [
    { from: node("source", "comment-1"), rel: "PART_OF", to: node("source", "item-1") },
    { from: node("person", "member-2"), rel: "AUTHORED", to: node("source", "comment-1") },
  ]);
});

test("A comment without an actor falls back to its creator, and with neither has no author", () => {
  const byCreator = commentBatch(teamScope, { ...comment, actor: null }, "x", links);
  assert.deepEqual(
    byCreator.people.map((p) => p.external_id),
    ["member-9"],
  );
  const anonymous = commentBatch(teamScope, { ...comment, actor: null, created_by: null }, "x", links);
  assert.deepEqual(anonymous.people, []);
  assert.equal(anonymous.links.length, 1);
});

test("A comment prefers its stripped text over its HTML", () => {
  const batch = commentBatch(teamScope, { ...comment, comment_stripped: "Plain" }, "x", links);
  assert.equal(batch.sources[0].text, "Plain");
});

const page: PlanePage = {
  id: "page-1",
  name: "ADR-002 Require human approval",
  description_html: "<p>Agents propose, people accept.</p>",
  owned_by: "member-1",
  access: 0,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-02T10:00:00Z",
};

test("A public page becomes a Doc in its project, with the project's visibility, authored by its owner", () => {
  const batch = pageBatch(teamScope, page, links);
  assert.deepEqual(batch.sources, [
    {
      connector: "plane",
      external_id: "page-1",
      labels: ["Doc"],
      url: "https://plane.example.test/acme/projects/proj-1/pages/page-1",
      title: "ADR-002 Require human approval",
      text: "ADR-002 Require human approval\n\nAgents propose, people accept.",
      created_at: "2026-10-01T10:00:00Z",
      updated_at: "2026-10-02T10:00:00Z",
      deleted_at: undefined,
      sensitivity: "team",
      visible_to: undefined,
    },
  ]);
  assert.deepEqual(batch.links, [
    { from: node("source", "page-1"), rel: "PART_OF", to: node("project", "proj-1") },
    { from: node("person", "member-1"), rel: "AUTHORED", to: node("source", "page-1") },
  ]);
});

test("A private page, or one without an access value, is visible to its owner only", () => {
  for (const access of [1, undefined]) {
    const [source] = pageBatch(teamScope, { ...page, access }, links).sources;
    assert.equal(source.sensitivity, "restricted");
    assert.deepEqual(source.visible_to, [{ connector: "plane", external_id: "member-1" }]);
  }
});

test("A page reads its text from the documented description field when there is no HTML field", () => {
  const { description_html: _, ...rest } = page;
  const [source] = pageBatch(teamScope, { ...rest, description: "<p>From description</p>" }, links).sources;
  assert.equal(source.text, "ADR-002 Require human approval\n\nFrom description");
});
