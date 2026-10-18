import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import recall from "@/lib/brain/tools/recall";
import { createInvite, getMember, joinWithCode, leaveWorkspace, listMemberships, removeMember, setRole } from "@/lib/workspaces";

import { callTool, contextFor, saveItem } from "../helpers/brain";
import { seedMember, seedWorkspace } from "../helpers/fixtures";
import { useTestGraphs } from "../helpers/graph";

useTestGraphs();

let n = 0;
let slug: string;
let adminId: string;
let memberId: string;

beforeEach(async () => {
  slug = `team-${++n}`;
  await seedWorkspace(slug);
  adminId = await seedMember(slug, `${slug}-admin`, "Admin", "Ada Admin");
  memberId = await seedMember(slug, `${slug}-member`, "Member", "Mel Member");
});

describe("setRole", () => {
  test("an Admin can promote a Member to Admin", async () => {
    await setRole(slug, `${slug}-admin`, memberId, "Admin");
    assert.equal((await getMember(slug, `${slug}-member`))?.role, "Admin");
  });

  test("a Member cannot change roles", async () => {
    await assert.rejects(setRole(slug, `${slug}-member`, memberId, "Admin"), /Only an Admin can change roles/);
    assert.equal((await getMember(slug, `${slug}-member`))?.role, "Member");
  });

  test("the last Admin cannot demote themselves", async () => {
    await assert.rejects(setRole(slug, `${slug}-admin`, adminId, "Member"), /at least one Admin/);
    assert.equal((await getMember(slug, `${slug}-admin`))?.role, "Admin");
  });

  test("an Admin can demote another Admin while one remains", async () => {
    await setRole(slug, `${slug}-admin`, memberId, "Admin");
    await setRole(slug, `${slug}-member`, adminId, "Guest");
    assert.equal((await getMember(slug, `${slug}-admin`))?.role, "Guest");
  });
});

describe("removeMember", () => {
  test("an Admin removes a Member's role and workspace membership", async () => {
    await removeMember(slug, `${slug}-admin`, memberId);
    assert.equal(await getMember(slug, `${slug}-member`), null);
    assert.deepEqual(await listMemberships(`${slug}-member`), []);
  });

  test("a Member cannot remove anyone", async () => {
    await seedMember(slug, `${slug}-guest`, "Guest");
    await assert.rejects(removeMember(slug, `${slug}-member`, `p_${slug}-guest`), /Only an Admin can remove people/);
    assert.equal((await getMember(slug, `${slug}-guest`))?.role, "Guest");
  });

  test("the only Admin cannot be removed", async () => {
    await assert.rejects(removeMember(slug, `${slug}-admin`, adminId), /at least one Admin/);
    assert.equal((await getMember(slug, `${slug}-admin`))?.role, "Admin");
  });

  test("a removed member's brain reads stop at once", async () => {
    const member = contextFor(slug, { personId: memberId, name: "Mel Member", role: "Member" });
    await saveItem(member, { title: "Cache tax rates daily", statement: "Tax rates are cached for a day.", about: ["tax"] });
    assert.match(await callTool(recall, { question: "tax rates" }, member), /Cache tax rates daily/);
    await removeMember(slug, `${slug}-admin`, memberId);
    assert.equal(await callTool(recall, { question: "tax rates" }, member), "Nothing saved in this workspace matches that question.");
  });
});

describe("leaveWorkspace", () => {
  test("a Member can leave", async () => {
    await leaveWorkspace(slug, `${slug}-member`);
    assert.equal(await getMember(slug, `${slug}-member`), null);
    assert.deepEqual(await listMemberships(`${slug}-member`), []);
  });

  test("the only Admin cannot leave", async () => {
    await assert.rejects(leaveWorkspace(slug, `${slug}-admin`), /You are the only Admin/);
    assert.equal((await getMember(slug, `${slug}-admin`))?.role, "Admin");
  });

  test("an Admin can leave once another Admin exists", async () => {
    await setRole(slug, `${slug}-admin`, memberId, "Admin");
    await leaveWorkspace(slug, `${slug}-admin`);
    assert.equal(await getMember(slug, `${slug}-admin`), null);
  });
});

describe("rejoining", () => {
  test("a removed member who rejoins gets the same Person and keeps their decisions", async () => {
    const member = contextFor(slug, { personId: memberId, name: "Mel Member", role: "Member" });
    const { itemId } = await saveItem(member, { title: "Use UTC in invoices", statement: "Invoices print UTC times.", about: ["invoices"] });
    await removeMember(slug, `${slug}-admin`, memberId);

    const code = await createInvite(slug, `${slug}-admin`, "Guest");
    await joinWithCode({ id: `${slug}-member`, name: "Mel Member" }, code);
    const rejoined = await getMember(slug, `${slug}-member`);
    assert.equal(rejoined?.personId, memberId);
    assert.equal(rejoined?.role, "Guest");

    const admin = contextFor(slug, { personId: adminId, name: "Ada Admin", role: "Admin" });
    assert.match(await callTool(recall, { question: "invoices UTC" }, admin), new RegExp(`Decision: Use UTC in invoices \\(accepted, ${itemId}\\)\\nBecause: .*\\nRejected: .*\\nDecided by: Mel Member`));
  });
});
