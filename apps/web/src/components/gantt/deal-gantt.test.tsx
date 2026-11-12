// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DealView } from "@/server/deals";
import DealGantt from "./deal-gantt";

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  load: vi.fn(async () => {}),
  destroy: vi.fn(),
}));
vi.mock("/bryntum/gantt.module.js", () => ({
  Gantt: class {
    project = { loadInlineData: mocks.load };
    destroy = mocks.destroy;
    constructor(config: unknown) {
      mocks.constructor(config);
    }
  },
}));
const view: DealView = {
  deal: {
    id: "deal",
    title: "Demo",
    status: "sent",
    currency: "USD",
    agencyName: "Agency",
    clientName: "Client",
    clientEmail: "client@example.com",
    clientPolicy: null,
  },
  milestones: [],
  tasks: [],
  dependencies: [],
  activity: [],
  approvals: [],
};
let root: Root;
let container: HTMLDivElement;
let stylesheet: HTMLStyleElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stylesheet = document.createElement("style");
  stylesheet.textContent = ".tranche-gantt { --bryntum-version: 7.3.7; }";
  document.head.append(stylesheet);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stylesheet.remove();
  vi.unstubAllGlobals();
});

it("shows a recoverable error instead of constructing an unstyled timeline", async () => {
  stylesheet.remove();
  await act(async () => root.render(<DealGantt view={view} onMove={async () => false} readOnly />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "The schedule did not load",
  );
  expect(mocks.constructor).not.toHaveBeenCalled();
});
it("keeps the preview read-only and finishes loading data before showing it", async () => {
  await act(async () => root.render(<DealGantt view={view} onMove={async () => false} readOnly />));
  expect(mocks.constructor).toHaveBeenCalledWith(
    expect.objectContaining({ readOnly: true, width: "100%" }),
  );
  expect(mocks.load).toHaveBeenCalled();
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector(".tranche-gantt")).not.toBeNull();
});
it("destroys the widget and shows a recovery action when its data cannot load", async () => {
  mocks.load.mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => root.render(<DealGantt view={view} onMove={async () => false} readOnly />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "The schedule did not load",
  );
  expect(mocks.destroy).toHaveBeenCalled();
  expect(container.textContent).toContain("Try again");
});
