import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, createWorkspace } from "./test-fixtures";
import { createWorkspaceFor } from "./workspaces";

const url = process.env.DATABASE_URL;

describe.runIf(Boolean(url))("createWorkspaceFor", () => {
  let db: Db;
  beforeAll(async () => {
    db = createDb(url);
    await migrateDb(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  async function nameFor(userName: string) {
    const { id: userId } = await createUser(db);
    const workspaceId = await createWorkspaceFor(db, { id: userId, name: userName });
    const [ws] = await db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId));
    return ws?.name;
  }

  it("creates a workspace owned by the new user", async () => {
    const { id: userId } = await createUser(db);
    const workspaceId = await createWorkspaceFor(db, { id: userId, name: "Ada Lovelace" });
    const [ws] = await db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId));
    const [member] = await db
      .select()
      .from(schema.workspaceMember)
      .where(eq(schema.workspaceMember.userId, userId));
    expect(ws?.name).toBe("Ada's studio");
    expect(member).toMatchObject({ workspaceId, role: "owner" });
  });

  it("names the studio after the first word only", async () => {
    expect(await nameFor("Grace")).toBe("Grace's studio");
  });

  it.each(["", "  ", "\t"])("falls back to My studio for the blank name %j", async (blank) => {
    expect(await nameFor(blank)).toBe("My studio");
  });

  it("gives the new workspace the default rate card", async () => {
    const { id: userId } = await createUser(db);
    const workspaceId = await createWorkspaceFor(db, { id: userId, name: "Ada Lovelace" });
    const [ws] = await db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId));
    expect(ws?.rateCard).toEqual({
      currency: "USD",
      dailyRateMinor: 60000,
      minimumProjectMinor: 0,
    });
  });

  async function studioOf(userId: string) {
    return db
      .select()
      .from(schema.workspaceMember)
      .where(eq(schema.workspaceMember.userId, userId));
  }

  function uniqueFirstName() {
    return `Zed${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  }

  it("returns the same workspace when called twice for one user", async () => {
    const user = await createUser(db);
    const first = await createWorkspaceFor(db, { id: user.id, name: user.name });
    const second = await createWorkspaceFor(db, { id: user.id, name: user.name });
    expect(second).toBe(first);
    expect(await studioOf(user.id)).toHaveLength(1);
  });

  it("creates exactly one workspace and membership under concurrent calls", async () => {
    const first = uniqueFirstName();
    const user = await createUser(db, `${first} Tester`);
    const ids = await Promise.all(
      Array.from({ length: 8 }, () => createWorkspaceFor(db, { id: user.id, name: user.name })),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await studioOf(user.id)).toHaveLength(1);
    const workspaces = await db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.name, `${first}'s studio`));
    expect(workspaces).toHaveLength(1);
  });

  it("does not create a second workspace for a user who already has one", async () => {
    const first = uniqueFirstName();
    const user = await createUser(db, `${first} Tester`);
    const existing = await createWorkspaceFor(db, { id: user.id, name: user.name });
    const again = await createWorkspaceFor(db, { id: user.id, name: "Someone Else" });
    expect(again).toBe(existing);
    const workspaces = await db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.name, `${first}'s studio`));
    expect(workspaces).toHaveLength(1);
  });

  describe("workspace_member.user_id foreign key", () => {
    it("deleting the user cascades to its memberships", async () => {
      const user = await createUser(db);
      await createWorkspaceFor(db, { id: user.id, name: user.name });
      expect(await studioOf(user.id)).toHaveLength(1);
      await db.delete(schema.user).where(eq(schema.user.id, user.id));
      expect(await studioOf(user.id)).toHaveLength(0);
    });

    it("rejects a membership for a user id that does not exist", async () => {
      const ws = await createWorkspace(db);
      await expect(
        db.insert(schema.workspaceMember).values({
          workspaceId: ws.id,
          userId: `user-${crypto.randomUUID()}`,
          role: "member",
        }),
      ).rejects.toThrow();
    });

    it("createWorkspaceFor fails for an unknown user and leaves no workspace behind", async () => {
      const first = uniqueFirstName();
      await expect(
        createWorkspaceFor(db, { id: `user-${crypto.randomUUID()}`, name: `${first} Ghost` }),
      ).rejects.toThrow();
      const workspaces = await db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.name, `${first}'s studio`));
      expect(workspaces).toHaveLength(0);
    });
  });
});
