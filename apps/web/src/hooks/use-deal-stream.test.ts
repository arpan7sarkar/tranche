// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "@/lib/sse";
import { useDealStream } from "./use-deal-stream";

type Listener = (e: unknown) => void;

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readyState = 0;
  closeCalls = 0;
  onopen: Listener | null = null;
  onmessage: Listener | null = null;
  onerror: Listener | null = null;
  private listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== listener),
    );
  }

  close() {
    this.closeCalls += 1;
    this.readyState = 2;
  }

  private dispatch(type: string, handler: Listener | null, event: unknown) {
    handler?.(event);
    for (const l of this.listeners.get(type) ?? []) l(event);
  }

  open() {
    this.readyState = 1;
    this.dispatch("open", this.onopen, { type: "open" });
  }

  message(id: number) {
    const event: StreamEvent = { id, dealId: "d1", milestoneId: null, type: "deal.plan_sent" };
    this.dispatch("message", this.onmessage, {
      type: "message",
      data: JSON.stringify(event),
      lastEventId: String(id),
    });
  }

  fail(readyState: 0 | 2 = 2) {
    this.readyState = readyState;
    this.dispatch("error", this.onerror, { type: "error" });
  }
}

const sources = () => FakeEventSource.instances;
const current = () => {
  const last = sources().at(-1);
  if (!last) throw new Error("no EventSource was created");
  return last;
};
const queryOf = (source: FakeEventSource) => new URL(source.url, "http://localhost").searchParams;

type Props = {
  onEvent?: (e: StreamEvent) => void;
  onOpen?: () => void;
  since?: number;
  dealId?: string;
};

function Probe(props: Props) {
  useDealStream(props.dealId ?? "d1", null, props.onEvent ?? (() => {}), props.since, props.onOpen);
  return null;
}

function ProbeThree(props: Pick<Props, "onEvent">) {
  useDealStream("d1", null, props.onEvent ?? (() => {}));
  return null;
}

function ProbeFour(props: Pick<Props, "onEvent" | "since">) {
  useDealStream("d1", null, props.onEvent ?? (() => {}), props.since);
  return null;
}

let root: Root | null = null;
let container: HTMLElement;

function mount(node: ReturnType<typeof createElement>) {
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
}

function unmount() {
  act(() => root?.unmount());
  root = null;
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function expectReconnectBetween(minMs: number, maxMs: number, from: FakeEventSource) {
  const before = sources().length;
  advance(minMs - 1);
  expect(sources()).toHaveLength(before);
  advance(maxMs - minMs + 1);
  expect(sources()).toHaveLength(before + 1);
  expect(current()).not.toBe(from);
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  if (root) unmount();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useDealStream", () => {
  describe("existing call forms", () => {
    it("works with three arguments: opens one source for the deal and delivers events", () => {
      const onEvent = vi.fn();
      mount(createElement(ProbeThree, { onEvent }));
      expect(sources()).toHaveLength(1);
      expect(queryOf(current()).get("dealId")).toBe("d1");
      current().open();
      current().message(5);
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
    });

    it("works with four arguments: since becomes lastEventId on the first connection", () => {
      const onEvent = vi.fn();
      mount(createElement(ProbeFour, { onEvent, since: 12 }));
      expect(queryOf(current()).get("lastEventId")).toBe("12");
      current().open();
      current().message(13);
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 13 }));
    });

    it("does not throw when a three-argument source fails and reconnects", () => {
      mount(createElement(ProbeThree, {}));
      current().open();
      current().fail();
      advance(60_000);
      expect(sources()).toHaveLength(2);
    });
  });

  describe("onOpen", () => {
    it("is called once on the first successful open, not before", () => {
      const onOpen = vi.fn();
      mount(createElement(Probe, { onOpen }));
      expect(onOpen).not.toHaveBeenCalled();
      current().open();
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it("is called again on every reconnect once it opens", () => {
      const onOpen = vi.fn();
      mount(createElement(Probe, { onOpen }));
      current().open();
      current().fail();
      advance(2_000);
      expect(onOpen).toHaveBeenCalledTimes(1);
      current().open();
      expect(onOpen).toHaveBeenCalledTimes(2);
      current().fail();
      advance(2_000);
      current().open();
      expect(onOpen).toHaveBeenCalledTimes(3);
    });

    it("calls the latest onOpen passed in, not the one from the first render", () => {
      const first = vi.fn();
      const second = vi.fn();
      mount(createElement(Probe, { onOpen: first }));
      act(() => root?.render(createElement(Probe, { onOpen: second })));
      expect(sources()).toHaveLength(1);
      current().open();
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  describe("reconnecting after the source is CLOSED", () => {
    it("reconnects after about 1s", () => {
      mount(createElement(Probe, {}));
      current().open();
      const failed = current();
      failed.fail();
      expectReconnectBetween(500, 1_500, failed);
    });

    it("reconnects when the connection never opened, e.g. a 401 or 503 response", () => {
      mount(createElement(Probe, {}));
      const failed = current();
      failed.fail();
      expectReconnectBetween(500, 1_500, failed);
    });

    it("doubles the delay while reconnects keep failing: about 1s, 2s, 4s", () => {
      mount(createElement(Probe, {}));
      for (const base of [1_000, 2_000, 4_000]) {
        const failed = current();
        failed.fail();
        expectReconnectBetween(base * 0.5, base * 1.5, failed);
      }
    });

    it("caps the delay at 30s", () => {
      mount(createElement(Probe, {}));
      for (let i = 0; i < 7; i++) {
        current().fail();
        advance(45_000);
      }
      const failed = current();
      failed.fail();
      expectReconnectBetween(15_000, 45_000, failed);
    });

    it("starts again from about 1s after a connection opened successfully", () => {
      mount(createElement(Probe, {}));
      for (let i = 0; i < 4; i++) {
        current().fail();
        advance(45_000);
      }
      current().open();
      const failed = current();
      failed.fail();
      expectReconnectBetween(500, 1_500, failed);
    });

    it("carries the last received event id in the reconnect URL", () => {
      mount(createElement(Probe, { since: 3 }));
      current().open();
      current().message(7);
      current().message(9);
      current().fail();
      advance(2_000);
      expect(sources()).toHaveLength(2);
      expect(queryOf(current()).get("lastEventId")).toBe("9");
      expect(queryOf(current()).get("dealId")).toBe("d1");
    });

    it("keeps resuming from the newest id across several reconnects", () => {
      mount(createElement(Probe, {}));
      current().open();
      current().message(4);
      current().fail();
      advance(2_000);
      expect(queryOf(current()).get("lastEventId")).toBe("4");
      current().open();
      current().message(8);
      current().fail();
      advance(2_000);
      expect(queryOf(current()).get("lastEventId")).toBe("8");
    });

    it("does not rewind the resume id when a failed reconnect receives nothing", () => {
      mount(createElement(Probe, {}));
      current().open();
      current().message(6);
      current().fail();
      advance(2_000);
      current().fail();
      advance(5_000);
      expect(queryOf(current()).get("lastEventId")).toBe("6");
    });

    it("delivers events from the reconnected source", () => {
      const onEvent = vi.fn();
      mount(createElement(Probe, { onEvent }));
      current().open();
      current().fail();
      advance(2_000);
      current().open();
      current().message(11);
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }));
    });
  });

  describe("never more than one connection", () => {
    it("opens no second source while the first is open", () => {
      mount(createElement(Probe, {}));
      current().open();
      advance(120_000);
      expect(sources()).toHaveLength(1);
    });

    it("opens no second source while the first is still connecting", () => {
      mount(createElement(Probe, {}));
      advance(120_000);
      expect(sources()).toHaveLength(1);
    });

    it("leaves a source that the browser is retrying itself alone", () => {
      mount(createElement(Probe, {}));
      current().open();
      current().fail(0);
      advance(120_000);
      expect(sources()).toHaveLength(1);
    });

    it("schedules a single reconnect when error fires repeatedly for one closed source", () => {
      mount(createElement(Probe, {}));
      current().open();
      const failed = current();
      failed.fail();
      failed.fail();
      failed.fail();
      advance(120_000);
      expect(sources()).toHaveLength(2);
    });

    it("closes the replaced source before or when it reconnects", () => {
      mount(createElement(Probe, {}));
      current().open();
      const failed = current();
      failed.fail();
      advance(2_000);
      expect(failed.closeCalls).toBeGreaterThan(0);
      expect(failed.readyState).toBe(2);
    });
  });

  describe("on unmount", () => {
    it("closes the open source", () => {
      mount(createElement(Probe, {}));
      current().open();
      const source = current();
      unmount();
      expect(source.closeCalls).toBeGreaterThan(0);
    });

    it("cancels a pending reconnect", () => {
      mount(createElement(Probe, {}));
      current().open();
      current().fail();
      unmount();
      advance(120_000);
      expect(sources()).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("ignores errors that arrive after unmount", () => {
      mount(createElement(Probe, {}));
      const source = current();
      unmount();
      source.fail();
      advance(120_000);
      expect(sources()).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("leaves no timers behind after a full reconnect cycle and unmount", () => {
      mount(createElement(Probe, {}));
      current().fail();
      advance(2_000);
      current().open();
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("when the deal changes", () => {
    it("closes the old source and opens exactly one for the new deal", () => {
      mount(createElement(Probe, { dealId: "d1" }));
      current().open();
      const old = current();
      act(() => root?.render(createElement(Probe, { dealId: "d2" })));
      expect(old.closeCalls).toBeGreaterThan(0);
      expect(sources()).toHaveLength(2);
      expect(queryOf(current()).get("dealId")).toBe("d2");
      old.fail();
      advance(120_000);
      expect(sources()).toHaveLength(2);
    });
  });
});
