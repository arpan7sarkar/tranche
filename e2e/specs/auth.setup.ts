import { schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { expect, test } from "../support/browser";
import { openFixtureDb } from "../support/database";
import { AGENCY, readState } from "../support/state";

test("create an agency session through Better Auth", async ({ request, baseURL }) => {
  const signup = await request.post("/api/auth/sign-up/email", {
    data: AGENCY,
    headers: { Origin: baseURL ?? "" },
  });
  expect(signup.ok()).toBe(true);
  const body = (await signup.json()) as { user: { id: string } };
  const db = await openFixtureDb();
  try {
    await db.delete(schema.workspaceMember).where(eq(schema.workspaceMember.userId, body.user.id));
    await db
      .insert(schema.workspaceMember)
      .values({ workspaceId: readState().workspaceId, userId: body.user.id, role: "owner" });
  } finally {
    await db.$client.end();
  }
  const signin = await request.post("/api/auth/sign-in/email", {
    data: { email: AGENCY.email, password: AGENCY.password },
    headers: { Origin: baseURL ?? "" },
  });
  expect(signin.ok()).toBe(true);
  await request.storageState({ path: ".state/agency.json" });
});
