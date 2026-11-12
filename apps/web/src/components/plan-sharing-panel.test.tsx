// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanSharingPanel } from "./plan-sharing-panel";

let root: Root;
let container: HTMLDivElement;
const status = { emailStatus: "unconfigured", sentAt: null, openedAt: null, localOnly: true };
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
});

it("explains manual sharing and localhost without claiming email delivery", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(status)),
  );
  await act(async () =>
    root.render(
      <PlanSharingPanel dealId="deal" clientEmail="fictional@example.com" initialUrl={null} />,
    ),
  );
  expect(container.textContent).toContain("Automatic email is not configured");
  expect(container.textContent).toContain("cannot be opened by a remote client");
  expect(container.textContent).toContain("Portal has not been opened yet");
});

it("keeps a private link available when clipboard access fails", async () => {
  const link = "http://localhost:3000/portal/fictional-test-token";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) =>
      Response.json(options?.method === "POST" ? { portalUrl: link } : status),
    ),
  );
  vi.stubGlobal("navigator", {
    clipboard: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
  });
  await act(async () =>
    root.render(
      <PlanSharingPanel dealId="deal" clientEmail="fictional@example.com" initialUrl={null} />,
    ),
  );
  await act(async () => container.querySelector("button")?.click());
  expect(container.querySelector("input")?.value).toBe(link);
  expect(container.textContent).toContain("Select and copy the client link below");
});

it("distinguishes provider acceptance and a link visit from confirmed receipt", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ...status,
        emailStatus: "sent",
        sentAt: "2026-11-12T10:00:00Z",
        openedAt: "2026-11-12T10:05:00Z",
        localOnly: false,
      }),
    ),
  );
  await act(async () =>
    root.render(
      <PlanSharingPanel dealId="deal" clientEmail="fictional@example.com" initialUrl={null} />,
    ),
  );
  expect(container.textContent).toContain("Inbox delivery is not confirmed");
  expect(container.textContent).toContain("Portal first opened");
  expect(container.textContent).toContain("does not confirm their identity or acceptance");
});

it("shows a recoverable status error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await act(async () =>
    root.render(
      <PlanSharingPanel dealId="deal" clientEmail="fictional@example.com" initialUrl={null} />,
    ),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not refresh sharing status",
  );
});
