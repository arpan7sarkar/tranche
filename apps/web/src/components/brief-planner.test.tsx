// @vitest-environment happy-dom
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BriefPlanner } from "./brief-planner";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
let root: Root;
let container: HTMLDivElement;
const plan = {
  summary: "Build the shop",
  currency: "USD",
  milestones: [
    {
      key: "build",
      title: "Build",
      price: { currency: "USD", minor: 10000 },
      criteria: {
        checks: [{ kind: "url_live", url: "https://example.com" }],
        prose: ["A working cart"],
      },
      payees: [{ kind: "agency", shareBps: 10000 }],
    },
  ],
  tasks: [{ key: "build", title: "Build", durationDays: 1, dependsOn: [], milestoneKey: "build" }],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("renders a labelled brief form without making requests", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<BriefPlanner initialDealId={null} />));
  expect(container.querySelector('label[for="brief"]')?.textContent).toBe("Project brief");
  expect(container.querySelector('input[name="clientEmail"]')?.getAttribute("type")).toBe("email");
  expect(fetch).not.toHaveBeenCalled();
});
it("shows recoverable errors without discarding a submitted brief", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: "Unable to load" }, { status: 503 })),
  );
  await act(async () => root.render(<BriefPlanner initialDealId="deal" />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to load");
  expect(container.textContent).toContain("Your brief is saved");
  expect(container.textContent).toContain("Check again");
});
it.each(["", "https://www.figma.com/design/abc/portfolio"])(
  "submits an optional reference without using it as a verification target: %s",
  async (reference) => {
    const fetch = vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? Response.json({ dealId: "new-deal" })
        : Response.json({ status: "planning" }),
    );
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<BriefPlanner initialDealId={null} />));
    const input = container.querySelector<HTMLInputElement>('[name="referenceUrl"]');
    const form = container.querySelector("form");
    assert(input && form);
    expect(input.required).toBe(false);
    input.value = reference;
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    const call = fetch.mock.calls.find(([, options]) => options?.method === "POST");
    assert(call);
    const body = JSON.parse(String(call[1]?.body));
    expect(body.referenceUrl).toBe(reference || null);
    expect(body).not.toHaveProperty("stagingUrl");
  },
);
it("preserves multiline edits and saves the reviewed draft before opening Gantt", async () => {
  const fetch = vi.fn(async (_url: string, options?: RequestInit) =>
    options?.method === "PUT"
      ? Response.json({ saved: true })
      : Response.json({ status: "ready", proposalId: "proposal", plan }),
  );
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<BriefPlanner initialDealId="deal" />));
  const criteria = container.querySelector<HTMLTextAreaElement>("#criteria-0");
  assert(criteria);
  await act(async () => {
    criteria.value = "A working cart\nMobile checkout";
    criteria.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  const button = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Save draft"),
  );
  assert(button);
  await act(async () => button.click());
  const call = fetch.mock.calls.find(([, options]) => options?.method === "PUT");
  assert(call);
  const body = JSON.parse(String(call[1]?.body));
  expect(body.plan.milestones[0].criteria.prose).toEqual(["A working cart", "Mobile checkout"]);
  expect(nav.push).toHaveBeenCalledWith("/deals/deal");
});
it("resumes a previously saved draft in its workspace", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ status: "saved" })),
  );
  await act(async () => root.render(<BriefPlanner initialDealId="deal" />));
  expect(nav.replace).toHaveBeenCalledWith("/deals/deal");
});
