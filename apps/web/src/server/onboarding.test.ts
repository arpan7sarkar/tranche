import { type Db, schema } from "@tranche/db";
import { createTestDb } from "@tranche/db/testing";
import { PayPalError, requiredSellerFeatures } from "@tranche/paypal";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { completeOnboarding } from "./onboarding";
import { createWorkspace } from "./test-fixtures";

describe.runIf(Boolean(process.env.DATABASE_URL))("seller connection checks", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb("onboarding_errors");
  });
  afterAll(async () => {
    await db.$client.end();
  });
  async function workspace() {
    const ws = await createWorkspace(db);
    await db
      .update(schema.workspace)
      .set({ paypalOnboarding: "pending" })
      .where(eq(schema.workspace.id, ws.id));
    return ws.id;
  }
  async function read(id: string) {
    const [ws] = await db.select().from(schema.workspace).where(eq(schema.workspace.id, id));
    if (!ws) throw new Error("test_workspace_missing");
    return ws;
  }
  it("persists authorization failure and suppresses concurrent and repeated checks", async () => {
    const id = await workspace();
    const getSellerStatus = vi.fn().mockRejectedValue(
      new PayPalError({
        status: 401,
        name: "AUTHORIZATION_ERROR",
        message: "private provider text",
        issue: null,
        debugId: "private-debug",
        retryable: false,
      }),
    );
    const input = { workspaceId: id, mechanism: "authorization" as const };
    await Promise.all([
      completeOnboarding(db, { getSellerStatus }, input),
      completeOnboarding(db, { getSellerStatus }, input),
    ]);
    await completeOnboarding(db, { getSellerStatus }, input);
    expect(getSellerStatus).toHaveBeenCalledTimes(1);
    expect(await read(id)).toMatchObject({
      paypalOnboarding: "pending",
      paypalCheckError: "authorization",
      paypalCheckedAt: expect.any(Date),
    });
    expect(JSON.stringify(await read(id))).not.toContain("private");
  });
  it("recovers after the cooldown and clears the error only on a successful check", async () => {
    const id = await workspace();
    await db
      .update(schema.workspace)
      .set({ paypalCheckError: "authorization", paypalCheckedAt: new Date(Date.now() - 61_000) })
      .where(eq(schema.workspace.id, id));
    const getSellerStatus = vi.fn().mockResolvedValue({
      merchantId: "SELLER",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
      grantedFeatures: requiredSellerFeatures("authorization"),
    });
    await completeOnboarding(
      db,
      { getSellerStatus },
      { workspaceId: id, mechanism: "authorization" },
    );
    expect(await read(id)).toMatchObject({
      paypalOnboarding: "active",
      paypalCheckError: null,
      paypalMerchantId: "SELLER",
    });
  });
  it("records outages without marking the seller active", async () => {
    const id = await workspace();
    const getSellerStatus = vi.fn().mockRejectedValue(
      new PayPalError({
        status: 503,
        name: "UNAVAILABLE",
        message: "down",
        issue: null,
        debugId: null,
        retryable: true,
      }),
    );
    await completeOnboarding(
      db,
      { getSellerStatus },
      { workspaceId: id, mechanism: "authorization" },
    );
    expect(await read(id)).toMatchObject({
      paypalOnboarding: "pending",
      paypalCheckError: "unavailable",
    });
  });
  it("keeps incomplete seller permissions pending after a successful read", async () => {
    const id = await workspace();
    const getSellerStatus = vi.fn().mockResolvedValue({
      merchantId: "SELLER",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
      grantedFeatures: ["PAYMENT", "REFUND"],
    });
    await completeOnboarding(
      db,
      { getSellerStatus },
      { workspaceId: id, mechanism: "authorization" },
    );
    expect(await read(id)).toMatchObject({
      paypalOnboarding: "pending",
      paypalCheckError: null,
      paypalMissingFeatures: ["PARTNER_FEE", "VAULT"],
    });
  });
});
