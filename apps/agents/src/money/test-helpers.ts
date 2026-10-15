import type {
  AcceptanceCriteria,
  HoldMechanism,
  HoldStatus,
  MilestoneState,
  Policy,
} from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { asc, eq } from "drizzle-orm";
import { vi } from "vitest";
import type { Deps, PayPal } from "./deps";
import { must } from "./errors";
import type { OutboxHandler } from "./outbox";

export const NOW = new Date("2026-10-10T10:00:00Z");

export const openPolicy: Policy = {
  perActionMaxMinor: 10_000_000,
  perMilestoneMaxMinor: 10_000_000,
  perDealMaxMinor: 10_000_000,
  autoReleaseAfterHours: 48,
  cooldownMinutes: 0,
  alwaysAsk: [],
};

const criteria: AcceptanceCriteria = {
  checks: [
    { kind: "ci_green", repo: "acme/site" },
    { kind: "url_live", url: "https://staging.acme.test" },
  ],
  prose: [],
};

export async function makeMilestone(
  db: Db,
  o: {
    state?: MilestoneState;
    heldMinor?: number;
    releasedMinor?: number;
    verifiedAt?: Date | null;
    releaseAuthorizedAt?: Date | null;
    clientPolicy?: Policy | null;
    vaultId?: string | null;
  } = {},
) {
  const [ws] = await db
    .insert(schema.workspace)
    .values({
      name: "Northwind",
      paypalMerchantId: "MERCHANT-AGENCY",
      paypalOnboarding: "active",
      rateCard: { currency: "USD", dailyRateMinor: 60000, minimumProjectMinor: 0 },
    })
    .returning();
  const [cl] = await db
    .insert(schema.client)
    .values({
      workspaceId: must(ws).id,
      name: "Acme",
      email: "buyer@acme.test",
      paypalVaultId: o.vaultId === undefined ? "VAULT-1" : o.vaultId,
    })
    .returning();
  const [dl] = await db
    .insert(schema.deal)
    .values({
      workspaceId: must(ws).id,
      clientId: must(cl).id,
      title: "Storefront",
      brief: "Rebuild",
      currency: "USD",
      status: "active",
      clientPolicy: o.clientPolicy === undefined ? openPolicy : o.clientPolicy,
      agencyPolicy: openPolicy,
    })
    .returning();
  const [ms] = await db
    .insert(schema.milestone)
    .values({
      dealId: must(dl).id,
      key: "build",
      position: 0,
      title: "Build",
      priceMinor: 100000,
      criteria,
      payees: [{ kind: "agency", shareBps: 10000 }],
      state: o.state ?? "draft",
      heldMinor: o.heldMinor ?? 0,
      releasedMinor: o.releasedMinor ?? 0,
      verifiedAt: o.verifiedAt ?? null,
      releaseAuthorizedAt: o.releaseAuthorizedAt ?? null,
    })
    .returning();
  return {
    workspaceId: must(ws).id,
    clientId: must(cl).id,
    dealId: must(dl).id,
    milestoneId: must(ms).id,
  };
}

export async function makeHold(
  db: Db,
  milestoneId: string,
  o: {
    status?: HoldStatus;
    mechanism?: HoldMechanism;
    authorizationId?: string | null;
    captureId?: string | null;
    anchorAt?: Date;
  } = {},
) {
  const [h] = await db
    .insert(schema.hold)
    .values({
      milestoneId,
      mechanism: o.mechanism ?? "authorization",
      paypalOrderId: "ORDER-1",
      paypalAuthorizationId: o.authorizationId ?? null,
      paypalCaptureId: o.captureId ?? null,
      originalAuthorizedAt: o.anchorAt ?? null,
      amountMinor: 100000,
      currency: "USD",
      status: o.status ?? "pending",
      expiresAt: new Date("2026-11-08T10:00:00Z"),
    })
    .returning();
  return must(h);
}

export function fakePayPal(overrides: Partial<Record<keyof PayPal, unknown>> = {}) {
  const expiresAt = "2026-11-08T10:00:00.000Z";
  return {
    createFundingOrder: vi.fn(async () => ({
      orderId: "ORDER-2",
      approveUrl: null,
      status: "COMPLETED",
    })),
    placeHold: vi.fn(async () => ({
      status: "active",
      captureId: null,
      authorizationId: "AUTH-2",
      expiresAt,
      honorExpiresAt: null,
      vaultId: "VAULT-1",
    })),
    renewHold: vi.fn(async () => ({
      authorizationId: "AUTH-2",
      expiresAt,
      honorExpiresAt: expiresAt,
    })),
    releaseHold: vi.fn(async () => ({ releaseRef: "CAPTURE-REL-1" })),
    voidHold: vi.fn(async () => undefined),
    sendPayouts: vi.fn(async () => ({ batchId: "BATCH-1" })),
    submitDisputeEvidence: vi.fn(async () => undefined),
    getAuthorization: vi.fn(async () => ({ status: "CREATED" })),
    getCapture: vi.fn(async () => ({ status: "COMPLETED" })),
    ...overrides,
  } as unknown as PayPal & {
    createFundingOrder: ReturnType<typeof vi.fn>;
    placeHold: ReturnType<typeof vi.fn>;
    renewHold: ReturnType<typeof vi.fn>;
  };
}

export function testDeps(db: Db, paypal: PayPal = fakePayPal(), now: () => Date = () => NOW): Deps {
  return { db, paypal, now };
}

export async function runOutboxHandler(
  handler: OutboxHandler,
  deps: Deps,
  o: { kind: string; request: Record<string, unknown>; requestId: string },
): Promise<void> {
  const [row] = await deps.db
    .insert(schema.outbox)
    .values({ ...o, nextAttemptAt: deps.now() })
    .returning();
  const outbox = must(row);
  const response = await handler.call(deps, outbox);
  await deps.db.transaction((tx) => handler.settle(tx, deps, outbox, response));
}

export async function eventTypes(db: Db, milestoneId: string): Promise<string[]> {
  const rows = await db
    .select({ type: schema.event.type })
    .from(schema.event)
    .where(eq(schema.event.milestoneId, milestoneId))
    .orderBy(asc(schema.event.id));
  return rows.map((r) => r.type);
}
