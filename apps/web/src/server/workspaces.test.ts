import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    const userId = `user-${crypto.randomUUID()}`;
    const workspaceId = await createWorkspaceFor(db, { id: userId, name: userName });
    const [ws] = await db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId));
    return ws?.name;
  }

  it("creates a workspace owned by the new user", async () => {
    const userId = `user-${crypto.randomUUID()}`;
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
    const userId = `user-${crypto.randomUUID()}`;
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
});
