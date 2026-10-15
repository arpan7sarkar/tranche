import { DomainEventType, MilestoneState } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import { describeEvent } from "./activity";
import { describeCheck } from "./criteria";
import { trustedImageUrl } from "./evidence-image";
import { milestoneTone } from "./milestone-tone";
import { formatMoney, totalOf } from "./money";
import { explainReschedule } from "./reschedule";

const TONES = ["neutral", "progress", "held", "verifying", "attention", "released", "danger"];

describe("formatMoney", () => {
  it("formats two-decimal currencies", () => {
    expect(formatMoney({ currency: "USD", minor: 123456 })).toBe("$1,234.56");
    expect(formatMoney({ currency: "USD", minor: 0 })).toBe("$0.00");
    expect(formatMoney({ currency: "EUR", minor: 5 }, "en-US")).toBe("€0.05");
  });

  it("formats zero-decimal currencies", () => {
    expect(formatMoney({ currency: "JPY", minor: 1500 })).toBe("¥1,500");
  });

  it("is exact for amounts beyond float division precision", () => {
    expect(formatMoney({ currency: "USD", minor: 9007199254740991 })).toBe(
      "$90,071,992,547,409.91",
    );
    expect(formatMoney({ currency: "JPY", minor: 9007199254740991 })).toBe(
      "¥9,007,199,254,740,991",
    );
  });

  it("sums minor units", () => {
    expect(totalOf("USD", [100, 250])).toEqual({ currency: "USD", minor: 350 });
  });
});

describe("milestoneTone", () => {
  it("labels every state", () => {
    for (const s of MilestoneState.options)
      expect(milestoneTone(s).label.length).toBeGreaterThan(0);
    expect(milestoneTone("held").tone).toBe("held");
    expect(milestoneTone("released").tone).toBe("released");
    expect(milestoneTone("disputed").tone).toBe("danger");
  });

  it("maps every state to one of the seven tones", () => {
    for (const s of MilestoneState.options) expect(TONES).toContain(milestoneTone(s).tone);
  });
});

describe("describeCheck", () => {
  it("describes each check kind", () => {
    expect(describeCheck({ kind: "pr_merged", repo: "a/b", base: "main" })).toBe(
      "Pull request merged into main in a/b",
    );
    expect(describeCheck({ kind: "ci_green", repo: "a/b" })).toBe("CI passes in a/b");
    expect(describeCheck({ kind: "url_live", url: "https://x.dev" })).toBe("https://x.dev is live");
    expect(
      describeCheck({ kind: "lighthouse", url: "https://x.dev", category: "performance", min: 90 }),
    ).toBe("Lighthouse performance 90+ on https://x.dev");
  });
});

describe("describeEvent", () => {
  it("describes events with and without payload details", () => {
    expect(describeEvent("milestone.held", { title: "Build" })).toBe("Funds held for Build");
    expect(describeEvent("milestone.held", {})).toBe("Funds held for a milestone");
  });

  it("falls back when the title is not a string", () => {
    expect(describeEvent("milestone.held", { title: 42 })).toBe("Funds held for a milestone");
  });

  it("describes every domain event type", () => {
    for (const type of DomainEventType.options) {
      const sentence = describeEvent(type, { title: "Build" });
      expect(sentence.trim().length, type).toBeGreaterThan(0);
    }
  });

  it("covers alert.raised", () => {
    expect(describeEvent("alert.raised", { kind: "paypal_down" }).trim().length).toBeGreaterThan(0);
  });
});

describe("explainReschedule", () => {
  it("names the blocking task by title with a readable date", () => {
    const tasks = [
      { key: "visual", title: "Visual design" },
      { key: "wire", title: "Wireframes" },
    ];
    expect(
      explainReschedule('task "visual" cannot start before "wire" ends on 2026-10-17', tasks),
    ).toBe('"Visual design" cannot start before "Wireframes" ends on Oct 17.');
  });
});

describe("trustedImageUrl", () => {
  const origin = "https://evidence.tranche.app";
  it("accepts https images from the evidence origin only", () => {
    expect(trustedImageUrl(`${origin}/s/1.png`, origin)).toBe(`${origin}/s/1.png`);
    expect(trustedImageUrl("http://evidence.tranche.app/s/1.png", origin)).toBeNull();
    expect(trustedImageUrl("https://evil.example/s/1.png", origin)).toBeNull();
    expect(trustedImageUrl("https://evidence.tranche.app.evil.example/1.png", origin)).toBeNull();
    expect(trustedImageUrl(`${origin}/s/1.png`, undefined)).toBeNull();
    expect(trustedImageUrl(42, origin)).toBeNull();
  });
});
