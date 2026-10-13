import { type Db, schema } from "@tranche/db";
import { eq, sql } from "drizzle-orm";

function workspaceName(userName: string): string {
  const first = userName.trim().split(/\s+/)[0];
  return first ? `${first}'s studio` : "My studio";
}

export async function createWorkspaceFor(
  db: Db,
  user: { id: string; name: string },
): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`);
    const [existing] = await tx
      .select({ workspaceId: schema.workspaceMember.workspaceId })
      .from(schema.workspaceMember)
      .where(eq(schema.workspaceMember.userId, user.id))
      .limit(1);
    if (existing) return existing.workspaceId;
    const [ws] = await tx
      .insert(schema.workspace)
      .values({
        name: workspaceName(user.name),
        rateCard: { currency: "USD", dailyRateMinor: 60000, minimumProjectMinor: 0 },
      })
      .returning({ id: schema.workspace.id });
    if (!ws) throw new Error("workspace insert returned no row");
    await tx
      .insert(schema.workspaceMember)
      .values({ workspaceId: ws.id, userId: user.id, role: "owner" });
    return ws.id;
  });
}
