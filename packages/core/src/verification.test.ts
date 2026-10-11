import type { AcceptanceCriteria } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import { verificationGate } from "./verification";

const criteria: AcceptanceCriteria = {
  checks: [
    { kind: "ci_green", repo: "acme/site" },
    { kind: "url_live", url: "https://staging.acme.test" },
  ],
  prose: [],
};

const ev = (checkIndex: number | null, passed: boolean | null, createdAt: string) => ({
  checkIndex,
  passed,
  createdAt,
});

describe("verificationGate", () => {
  it("passes when the latest evidence for every check passed", () => {
    expect(
      verificationGate(criteria, [
        ev(0, true, "2026-10-10T10:00:00Z"),
        ev(1, true, "2026-10-10T10:00:00Z"),
      ]),
    ).toEqual({ passed: true, failing: [] });
  });

  it("fails checks with no evidence", () => {
    expect(verificationGate(criteria, [ev(0, true, "2026-10-10T10:00:00Z")])).toEqual({
      passed: false,
      failing: [1],
    });
  });

  it("uses the latest evidence per check", () => {
    const evidence = [
      ev(0, true, "2026-10-10T10:00:00Z"),
      ev(0, false, "2026-10-10T11:00:00Z"),
      ev(1, false, "2026-10-10T10:00:00Z"),
      ev(1, true, "2026-10-10T11:00:00+01:00"),
    ];
    expect(verificationGate(criteria, evidence)).toEqual({ passed: false, failing: [0, 1] });
  });

  it("treats a same-timestamp conflict as failing", () => {
    const evidence = [
      ev(0, true, "2026-10-10T10:00:00Z"),
      ev(0, false, "2026-10-10T10:00:00Z"),
      ev(1, true, "2026-10-10T10:00:00Z"),
    ];
    expect(verificationGate(criteria, evidence)).toEqual({ passed: false, failing: [0] });
  });

  it("ignores informational and out-of-range evidence", () => {
    const evidence = [
      ev(null, true, "2026-10-10T12:00:00Z"),
      ev(7, true, "2026-10-10T12:00:00Z"),
      ev(0, null, "2026-10-10T12:00:00Z"),
      ev(1, true, "2026-10-10T12:00:00Z"),
    ];
    expect(verificationGate(criteria, evidence)).toEqual({ passed: false, failing: [0] });
  });
});
