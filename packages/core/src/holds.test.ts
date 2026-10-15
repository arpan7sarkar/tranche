import { describe, expect, it } from "vitest";
import { renewalAction } from "./holds";

const anchor = "2026-10-01T00:00:00Z";
const at = (days: number) => new Date(Date.parse(anchor) + days * 86_400_000).toISOString();

describe("renewalAction", () => {
  it("does nothing until 4 full days have passed, since PayPal rejects earlier reauthorization", () => {
    expect(renewalAction("authorization", anchor, at(3))).toEqual({ kind: "none" });
    expect(renewalAction("authorization", anchor, at(3.9))).toEqual({ kind: "none" });
  });

  it("reauthorizes from day 4 until day 27", () => {
    expect(renewalAction("authorization", anchor, at(4))).toEqual({ kind: "reauthorize" });
    expect(renewalAction("authorization", anchor, at(26.9))).toEqual({ kind: "reauthorize" });
  });

  it("replaces the authorization from day 27", () => {
    expect(renewalAction("authorization", anchor, at(27))).toEqual({ kind: "new_authorization" });
    expect(renewalAction("authorization", anchor, at(40))).toEqual({ kind: "new_authorization" });
  });

  it("counts days left down to the day-27 deadline, robust to a late tick", () => {
    expect(renewalAction("delayed_disbursement", anchor, at(24))).toEqual({ kind: "none" });
    expect(renewalAction("delayed_disbursement", anchor, at(25))).toEqual({
      kind: "alert",
      daysLeft: 2,
    });
    expect(renewalAction("delayed_disbursement", anchor, at(25 + 1 / 1440))).toEqual({
      kind: "alert",
      daysLeft: 2,
    });
    expect(renewalAction("delayed_disbursement", anchor, at(30))).toEqual({
      kind: "alert",
      daysLeft: 0,
    });
  });

  it("rejects unparseable timestamps instead of replacing the authorization", () => {
    expect(() => renewalAction("authorization", "garbage", at(5))).toThrow();
    expect(() => renewalAction("authorization", anchor, "garbage")).toThrow();
  });

  it("reauthorizes only once, then waits for the day-27 replacement", () => {
    expect(renewalAction("authorization", anchor, at(10), at(4))).toEqual({ kind: "none" });
    expect(renewalAction("authorization", anchor, at(27), at(4))).toEqual({
      kind: "new_authorization",
    });
  });
});
