import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { one } from "./test-fixtures";

const url = process.env.DATABASE_URL;

describe.runIf(Boolean(url))("Better Auth sign-up", () => {
  let db: Db;
  let auth: typeof import("@/server/auth").auth;

  beforeAll(async () => {
    db = createDb(url);
    process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
    process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
    await migrateDb(db);
    ({ auth } = await import("@/server/auth"));
  });
  afterAll(async () => {
    await db.$client.end();
  });

  function identity() {
    const tag = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    return { tag, first: `Zed${tag}`, name: `Zed${tag} Tester`, email: `zed-${tag}@test.dev` };
  }

  it("creates one user, one workspace and one owner membership", async () => {
    const who = identity();
    await auth.api.signUpEmail({
      body: { email: who.email, password: "correct-horse-battery", name: who.name },
    });

    const users = await db.select().from(schema.user).where(eq(schema.user.email, who.email));
    expect(users).toHaveLength(1);
    const userId = one(users).id;

    const members = await db
      .select()
      .from(schema.workspaceMember)
      .where(eq(schema.workspaceMember.userId, userId));
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ role: "owner" });

    const workspaces = await db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.name, `${who.first}'s studio`));
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.id).toBe(members[0]?.workspaceId);
  });

  it("rejects a password shorter than 10 characters and creates nothing", async () => {
    const who = identity();
    await expect(
      auth.api.signUpEmail({ body: { email: who.email, password: "short-pw1", name: who.name } }),
    ).rejects.toThrow();

    const users = await db.select().from(schema.user).where(eq(schema.user.email, who.email));
    expect(users).toHaveLength(0);
    const workspaces = await db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.name, `${who.first}'s studio`));
    expect(workspaces).toHaveLength(0);
  });

  it("accepts a password of exactly 10 characters", async () => {
    const who = identity();
    await auth.api.signUpEmail({
      body: { email: who.email, password: "0123456789", name: who.name },
    });
    const users = await db.select().from(schema.user).where(eq(schema.user.email, who.email));
    expect(users).toHaveLength(1);
  });
});
