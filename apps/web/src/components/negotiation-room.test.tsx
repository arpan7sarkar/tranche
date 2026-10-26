// @vitest-environment happy-dom
import type { NegotiationView } from "@tranche/agents";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DealView } from "@/server/deals";
import { NegotiationRoom } from "./negotiation-room";

vi.mock("@/hooks/use-deal-stream", () => ({ useDealStream: vi.fn() }));
vi.mock("@/components/gantt/gantt-loader", () => ({
  GanttLoader: ({ readOnly }: { readOnly: boolean }) => (
    <div data-testid="preview" data-readonly={String(readOnly)} />
  ),
}));
const deal: DealView = {
  deal: {
    id: crypto.randomUUID(),
    title: "Shop",
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
const view: NegotiationView = {
  id: crypto.randomUUID(),
  dealId: deal.deal.id,
  status: "open",
  currency: "USD",
  applicationStatus: null,
  startDate: "2026-11-02",
  turns: [],
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("labels the simulation and requires confirmation before starting", async () => {
  await act(async () => root.render(<NegotiationRoom deal={deal} initial={null} />));
  expect(container.textContent).toContain("Simulated client agent");
  expect(container.querySelector('label[for="client-budget"]')).not.toBeNull();
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  expect(container.querySelector('[data-testid="preview"]')?.getAttribute("data-readonly")).toBe(
    "true",
  );
});
it("distinguishes agents agreeing from the plan being applied", async () => {
  await act(async () =>
    root.render(
      <NegotiationRoom
        deal={deal}
        initial={{ ...view, status: "agreed", applicationStatus: "needs_approval" }}
      />,
    ),
  );
  expect(container.textContent).toContain("Agents agreed on terms");
  expect(container.textContent).toContain("needs_approval");
  expect(container.querySelector("form")).toBeNull();
});
it("shows loading and recoverable polling failures", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await act(async () => root.render(<NegotiationRoom deal={deal} initial={view} />));
  expect(container.textContent).toContain("Waiting for the next turn");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Try again");
});
it("shows escalation and permits reviewing new limits", async () => {
  await act(async () =>
    root.render(<NegotiationRoom deal={deal} initial={{ ...view, status: "escalated" }} />),
  );
  expect(container.textContent).toContain("Human review required");
  expect(container.querySelector("form")).not.toBeNull();
});
