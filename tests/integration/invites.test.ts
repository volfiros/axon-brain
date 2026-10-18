import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { createInvite, currentInvites, findInvite, getMember, joinWithCode, revokeInvite } from "@/lib/workspaces";
import { accountsGraph } from "@/lib/graph/client";

import { seedAccount, seedMember, seedWorkspace } from "../helpers/fixtures";
import { useTestGraphs } from "../helpers/graph";

useTestGraphs();

let n = 0;
let slug: string;

beforeEach(async () => {
  slug = `acme-${++n}`;
  await seedWorkspace(slug);
  await seedMember(slug, `${slug}-admin`, "Admin");
});

describe("invite links", () => {
  test("a Member link and a Guest link are live at once", async () => {
    const member = await createInvite(slug, `${slug}-admin`, "Member");
    const guest = await createInvite(slug, `${slug}-admin`, "Guest");
    assert.deepEqual(await currentInvites(slug), { Member: member, Guest: guest });
  });

  test("each link joins with its own role", async () => {
    const member = await createInvite(slug, `${slug}-admin`, "Member");
    const guest = await createInvite(slug, `${slug}-admin`, "Guest");
    await seedAccount(`${slug}-m`);
    await seedAccount(`${slug}-g`);
    await joinWithCode({ id: `${slug}-m`, name: "M" }, member);
    await joinWithCode({ id: `${slug}-g`, name: "G" }, guest);
    assert.equal((await getMember(slug, `${slug}-m`))?.role, "Member");
    assert.equal((await getMember(slug, `${slug}-g`))?.role, "Guest");
  });

  test("a pasted full link resolves like a bare code", async () => {
    const code = await createInvite(slug, `${slug}-admin`, "Member");
    assert.equal((await findInvite(`https://axonteam.vercel.app/join/${code}?x=1`))?.role, "Member");
  });

  test("an existing member keeps their role when they open a link", async () => {
    const guest = await createInvite(slug, `${slug}-admin`, "Guest");
    await joinWithCode({ id: `${slug}-admin`, name: "Admin" }, guest);
    assert.equal((await getMember(slug, `${slug}-admin`))?.role, "Admin");
  });

  test("replacing one link turns off only that link", async () => {
    const oldMember = await createInvite(slug, `${slug}-admin`, "Member");
    const guest = await createInvite(slug, `${slug}-admin`, "Guest");
    const newMember = await createInvite(slug, `${slug}-admin`, "Member");
    assert.equal(await findInvite(oldMember), null);
    assert.deepEqual(await currentInvites(slug), { Member: newMember, Guest: guest });
  });

  test("revoking one link keeps the other", async () => {
    const member = await createInvite(slug, `${slug}-admin`, "Member");
    await createInvite(slug, `${slug}-admin`, "Guest");
    await revokeInvite(slug, `${slug}-admin`, "Guest");
    assert.deepEqual(await currentInvites(slug), { Member: member, Guest: null });
  });

  test("a link made before roles existed joins as Guest", async () => {
    await accountsGraph().query(
      `MATCH (w:Workspace {slug: $slug})
       CREATE (:Invite {code: $code, created_at: localdatetime(), expires_at: localdatetime() + duration({days: 7})})-[:FOR]->(w)`,
      { slug, code: `${slug}-legacy` },
    );
    await seedAccount(`${slug}-old`);
    await joinWithCode({ id: `${slug}-old`, name: "Old" }, `${slug}-legacy`);
    assert.equal((await getMember(slug, `${slug}-old`))?.role, "Guest");
  });

  test("an expired link does not work", async () => {
    await accountsGraph().query(
      `MATCH (w:Workspace {slug: $slug})
       CREATE (:Invite {code: $code, role: 'Member', created_at: localdatetime(), expires_at: localdatetime() - duration({days: 1})})-[:FOR]->(w)`,
      { slug, code: `${slug}-expired` },
    );
    assert.equal(await findInvite(`${slug}-expired`), null);
    await assert.rejects(joinWithCode({ id: "x", name: "X" }, `${slug}-expired`), /not valid or has expired/);
  });

  test("Admin links are refused", async () => {
    await assert.rejects(createInvite(slug, `${slug}-admin`, "Admin" as never), /only add a Member or a Guest/);
  });

  test("only an Admin can make or revoke links", async () => {
    await seedMember(slug, `${slug}-member`, "Member");
    await assert.rejects(createInvite(slug, `${slug}-member`, "Guest"), /Only an Admin/);
    await assert.rejects(revokeInvite(slug, `${slug}-member`, "Guest"), /Only an Admin/);
  });
});
