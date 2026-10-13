import { type Db, schema } from "@tranche/db";

export function one<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("expected a row");
  return row;
}

export async function createUser(db: Db, name = "Test User") {
  const tag = crypto.randomUUID();
  return one(
    await db
      .insert(schema.user)
      .values({
        id: `user-${tag}`,
        name,
        email: `user-${tag}@test.dev`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning(),
  );
}

const RATE_CARD = { currency: "USD", dailyRateMinor: 1, minimumProjectMinor: 0 } as const;

export async function createWorkspace(db: Db, name = `ws-${crypto.randomUUID()}`) {
  return one(await db.insert(schema.workspace).values({ name, rateCard: RATE_CARD }).returning());
}

export async function createDeal(db: Db, opts: { milestones?: number } = {}) {
  const ws = await createWorkspace(db);
  const client = one(
    await db
      .insert(schema.client)
      .values({
        workspaceId: ws.id,
        name: "Client",
        email: `client-${crypto.randomUUID()}@test.dev`,
      })
      .returning(),
  );
  const deal = one(
    await db
      .insert(schema.deal)
      .values({
        workspaceId: ws.id,
        clientId: client.id,
        title: `Deal ${crypto.randomUUID()}`,
        brief: "brief",
        currency: "USD",
      })
      .returning(),
  );
  const count = opts.milestones ?? 0;
  const milestones =
    count === 0
      ? []
      : await db
          .insert(schema.milestone)
          .values(
            Array.from({ length: count }, (_, i) => ({
              dealId: deal.id,
              key: `m${i}`,
              position: i,
              title: `Milestone ${i}`,
              priceMinor: 1000 * (i + 1),
              criteria: { checks: [], prose: ["done"] },
              payees: [{ kind: "agency" as const, shareBps: 10000 }],
            })),
          )
          .returning();
  return { workspaceId: ws.id, clientId: client.id, deal, milestones };
}

export async function addApproval(
  db: Db,
  dealId: string,
  opts: { decision: "approved" | "rejected" | null; side?: "agency" | "client" },
) {
  const side = opts.side ?? "agency";
  const action = one(
    await db
      .insert(schema.proposedAction)
      .values({
        dealId,
        agent: "monitor",
        side,
        type: "flag_risk",
        payload: { type: "flag_risk", milestoneId: null, severity: "low", message: "m" },
        reasoning: "because",
        idempotencyKey: `idem-${crypto.randomUUID()}`,
        status: opts.decision ? "approved" : "needs_approval",
      })
      .returning(),
  );
  return one(
    await db
      .insert(schema.approval)
      .values({
        proposedActionId: action.id,
        side,
        decision: opts.decision,
        decidedBy: opts.decision ? "user-x" : null,
        decidedAt: opts.decision ? new Date() : null,
      })
      .returning(),
  );
}
