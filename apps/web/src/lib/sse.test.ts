import { describe, expect, it } from "vitest";
import { type StreamEvent, sseFrame } from "./sse";

const event: StreamEvent = {
  id: 42,
  dealId: "6f1c1d9e-0000-4000-8000-000000000001",
  milestoneId: null,
  type: "milestone.held",
};

describe("sseFrame", () => {
  it("writes the id line, one data line and a blank line", () => {
    expect(sseFrame(event)).toBe(`id: 42\ndata: ${JSON.stringify(event)}\n\n`);
  });

  it("round-trips the event through the data line", () => {
    const data = sseFrame(event).split("\n")[1] ?? "";
    expect(data.startsWith("data: ")).toBe(true);
    expect(JSON.parse(data.slice("data: ".length))).toEqual(event);
  });

  it("keeps the frame to exactly two lines even when a field holds a newline", () => {
    const tricky = { ...event, dealId: "a\nb\r\nc" };
    const frame = sseFrame(tricky);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(frame.slice(0, -2).split("\n")).toHaveLength(2);
    expect(frame).not.toContain("\r");
  });

  it("carries a null dealId and milestoneId", () => {
    const frame = sseFrame({ id: 1, dealId: null, milestoneId: null, type: "deal.created" });
    expect(JSON.parse((frame.split("\n")[1] ?? "").slice(6))).toEqual({
      id: 1,
      dealId: null,
      milestoneId: null,
      type: "deal.created",
    });
  });

  it("is parseable by the id regex the stream reader uses", () => {
    expect(/^id: (\d+)$/m.exec(sseFrame(event))?.[1]).toBe("42");
  });
});
