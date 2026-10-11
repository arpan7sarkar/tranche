import { describe, expect, it } from "vitest";
import { addDays, daysBetween, maxDate, minDate } from "./dates";

describe("dates", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-05", -5)).toBe("2026-09-30");
  });

  it("rolls over leap days", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("rejects impossible dates", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow();
    expect(() => addDays("2026-1-5", 1)).toThrow();
    expect(() => addDays("not a date", 1)).toThrow();
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-10-31", "2026-10-01")).toBe(-30);
  });

  it("compares dates", () => {
    expect(maxDate("2026-10-01", "2026-09-30")).toBe("2026-10-01");
    expect(minDate("2026-10-01", "2026-09-30")).toBe("2026-09-30");
  });
});
