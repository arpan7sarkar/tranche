import { describe, expect, it } from "vitest";
import { pendingOrderVerdict } from "./pending-order";

const now = new Date("2026-10-15T12:00:00Z");
const later = new Date("2026-10-15T13:00:00Z");
const earlier = new Date("2026-10-15T11:00:00Z");

describe("pendingOrderVerdict", () => {
  it("never fails a completed order, even past its expiry", () => {
    expect(pendingOrderVerdict("COMPLETED", later, now)).toBe("confirming");
    expect(pendingOrderVerdict("COMPLETED", earlier, now)).toBe("confirming");
  });

  it("reuses an order awaiting the buyer until it expires", () => {
    expect(pendingOrderVerdict("PAYER_ACTION_REQUIRED", later, now)).toBe("reuse");
    expect(pendingOrderVerdict("APPROVED", earlier, now)).toBe("dead");
  });

  it("fails only voided or vanished orders otherwise", () => {
    expect(pendingOrderVerdict("VOIDED", later, now)).toBe("dead");
    expect(pendingOrderVerdict(null, later, now)).toBe("dead");
    expect(pendingOrderVerdict("SAVED", later, now)).toBe("wait");
  });
});
