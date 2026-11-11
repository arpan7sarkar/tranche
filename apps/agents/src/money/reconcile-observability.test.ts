import { describe, expect, it, vi } from "vitest";
import type { Deps } from "./deps";
import { reconcile } from "./reconcile";

const now = new Date("2026-11-11T00:00:00.000Z");

function active(id: string, authorizationId: string | null) {
  return {
    hold: {
      id,
      milestoneId: `milestone-${id}`,
      status: "active",
      mechanism: "authorization",
      paypalAuthorizationId: authorizationId,
    },
    dealId: "deal",
    state: "funded",
    updatedAt: now,
  };
}

function setup(activeRows: unknown[], pendingRows: unknown[] = []) {
  const rows: unknown[][] = [activeRows, [], pendingRows];
  const events: unknown[] = [];
  const getAuthorization = vi.fn();
  const getCapture = vi.fn();
  const getOrder = vi.fn();
  function query() {
    return Object.assign(
      Promise.resolve().then(() => rows.shift() ?? []),
      {
        from() {
          return this;
        },
        innerJoin() {
          return this;
        },
        where() {
          return this;
        },
        limit() {
          return this;
        },
      },
    );
  }
  const db = {
    select: vi.fn(query),
    transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        insert: () => ({
          values: (event: unknown) => ({
            returning: async () => {
              events.push(event);
              return [{ id: events.length }];
            },
          }),
        }),
      }),
    ),
  };
  return {
    deps: {
      db,
      paypal: { getAuthorization, getCapture, getOrder },
      now: () => now,
    } as unknown as Deps,
    rows,
    events,
    getAuthorization,
    getOrder,
  };
}

describe("reconciliation observability", () => {
  it("counts checked attempts separately from unavailable and unknown outcomes while preserving alerts", async () => {
    const test = setup([
      active("missing-reference", null),
      active("provider-down", "unavailable"),
      active("matched", "matched"),
      active("different", "different"),
    ]);
    test.rows.splice(2, 0, []);
    test.getAuthorization.mockImplementation(async (id: string) => {
      if (id === "unavailable") throw new Error("synthetic provider failure");
      return { status: id === "matched" ? "CREATED" : "VOIDED" };
    });

    const result = await reconcile(test.deps);
    expect(result).toEqual({ checked: 4, mismatches: 1, recovered: 0, unavailable: 1, unknown: 1 });
    expect(test.getAuthorization).toHaveBeenCalledTimes(3);
    expect(test.events).toHaveLength(2);
    expect(test.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "alert.raised",
          payload: expect.objectContaining({ kind: "reconciliation", holdId: "different" }),
        }),
        expect.objectContaining({
          type: "alert.raised",
          payload: expect.objectContaining({ kind: "reconciliation_unavailable", holds: 1 }),
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("synthetic provider failure");
    expect(JSON.stringify(result)).not.toContain("missing-reference");
  });

  it("counts an unreachable pending-order lookup as attempted and unavailable", async () => {
    const test = setup([], [{ id: "pending", milestoneId: "m", paypalOrderId: "test-order" }]);
    test.getOrder.mockRejectedValue(new Error("synthetic network failure"));
    expect(await reconcile(test.deps)).toEqual({
      checked: 1,
      mismatches: 0,
      recovered: 0,
      unavailable: 1,
      unknown: 0,
    });
    expect(test.getOrder).toHaveBeenCalledOnce();
    expect(test.events).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ kind: "reconciliation_unavailable", holds: 1 }),
      }),
    ]);
  });

  it("reports zero attempts as zero rather than a successful reconciliation", async () => {
    const test = setup([]);
    expect(await reconcile(test.deps)).toEqual({
      checked: 0,
      mismatches: 0,
      recovered: 0,
      unavailable: 0,
      unknown: 0,
    });
    expect(test.events).toEqual([]);
    expect(test.getAuthorization).not.toHaveBeenCalled();
    expect(test.getOrder).not.toHaveBeenCalled();
  });
});
