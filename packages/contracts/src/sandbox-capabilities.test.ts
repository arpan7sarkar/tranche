import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SandboxOperationSpec, SandboxReport } from "./sandbox-capabilities";

const input = {
  version: 1,
  kind: "payout",
  currency: "USD",
  sender: "platform",
  recipients: [{ alias: "seller-b", cents: 10 }],
  feeBoundCents: 1,
  commitmentId: randomUUID(),
  resourceKey: "fixture",
  recoveryCalls: 2,
  request: { method: "POST", path: "/v1/payments/payouts", body: {} },
};

describe("sandbox contracts", () => {
  it("rejects split sums and fees exceeding the total allowance", () => {
    expect(
      SandboxOperationSpec.safeParse({
        ...input,
        recipients: [
          { alias: "seller-a", cents: 50 },
          { alias: "seller-b", cents: 50 },
        ],
      }).success,
    ).toBe(false);
  });
  it.each([
    { currency: "EUR" },
    { feeBoundCents: -1 },
    { feeBoundCents: 0.1 },
    { kind: "unknown" },
    { recipients: [{ alias: "platform", cents: 1 }] },
    {
      recipients: [
        { alias: "seller-b", cents: 1 },
        { alias: "seller-b", cents: 1 },
      ],
    },
    { secret: "FAKE_SECRET" },
    { resourceKey: "https://evil.example" },
  ])("rejects malformed or unexpected input %j", (change) => {
    expect(SandboxOperationSpec.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it("reports cannot include private data", () => {
    expect(
      SandboxReport.safeParse({
        runId: randomUUID(),
        capability: "supported",
        merchantId: "PRIVATE",
      }).success,
    ).toBe(false);
  });
});
