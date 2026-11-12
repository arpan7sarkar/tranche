import "server-only";
import { gmailConfig } from "@tranche/agents-service/gmail";
import { createMagicLink, type Db, schema } from "@tranche/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";

export async function getPlanSharing(db: Db, dealId: string) {
  const [sent] = await db
    .select()
    .from(schema.event)
    .where(and(eq(schema.event.dealId, dealId), eq(schema.event.type, "deal.plan_sent")))
    .orderBy(desc(schema.event.id))
    .limit(1);
  const [opened] = await db
    .select({ createdAt: schema.event.createdAt })
    .from(schema.event)
    .where(and(eq(schema.event.dealId, dealId), eq(schema.event.type, "deal.portal_opened")))
    .orderBy(asc(schema.event.id))
    .limit(1);
  const [job] = sent
    ? await db
        .select({ status: schema.notificationJob.status, sentAt: schema.notificationJob.sentAt })
        .from(schema.notificationJob)
        .where(
          and(
            eq(schema.notificationJob.dealId, dealId),
            sql`${schema.notificationJob.key} like ${`event:${sent.id}:%`}`,
          ),
        )
        .orderBy(desc(schema.notificationJob.createdAt))
        .limit(1)
    : [];
  const [gmail] = await db
    .select({ email: schema.gmailConnection.email })
    .from(schema.gmailConnection)
    .innerJoin(schema.deal, eq(schema.deal.workspaceId, schema.gmailConnection.workspaceId))
    .where(eq(schema.deal.id, dealId));
  const emailConfigured = Boolean(
    (gmail && gmailConfig()) || (process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  );
  const host = new URL(process.env.APP_URL ?? "http://localhost:3000").hostname;
  return {
    emailStatus: !emailConfigured
      ? !job || job.status === "pending"
        ? "unconfigured"
        : job.status
      : (job?.status ?? "queued"),
    senderEmail: gmail?.email ?? null,
    sentAt: job?.sentAt?.toISOString() ?? null,
    openedAt: opened?.createdAt.toISOString() ?? null,
    localOnly:
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host === "[::1]",
  };
}

export type PlanSharing = Awaited<ReturnType<typeof getPlanSharing>>;

export async function createPlanShareLink(db: Db, dealId: string) {
  const [deal] = await db.select().from(schema.deal).where(eq(schema.deal.id, dealId));
  if (!deal || deal.status === "draft" || deal.status === "cancelled") return null;
  return (await createMagicLink(db, { dealId, clientId: deal.clientId })).url;
}

export async function recordPortalOpened(db: Db, dealId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`portal-opened:${dealId}`}, 0))`,
    );
    const [previous] = await tx
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(and(eq(schema.event.dealId, dealId), eq(schema.event.type, "deal.portal_opened")))
      .limit(1);
    if (previous) return;
    await tx.insert(schema.event).values({ dealId, type: "deal.portal_opened", payload: {} });
  });
}
