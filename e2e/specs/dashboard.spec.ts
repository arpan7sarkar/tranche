import { expect, test } from "../support/browser";

test("dashboard loads scoped cash flow in light and dark mode", async ({ page }) => {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") console.log(message.text());
  });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Cash flow", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveValue("USD");
  await expect(page.getByText("Held by PayPal", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Slip and replan", { exact: true }).first()).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page.locator("[data-ag-theme-mode]")).toHaveAttribute("data-ag-theme-mode", "dark");
});

test("dashboard shows loading, recovers from an error, and explains an empty workspace", async ({
  page,
}) => {
  let respond!: () => void;
  const gate = new Promise<void>((resolve) => {
    respond = resolve;
  });
  let fail = true;
  await page.route("**/api/dashboard/data?*", async (route) => {
    if (fail) {
      await gate;
      await route.fulfill({ status: 503, json: { error: "dashboard_unavailable" } });
    } else {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ json: { ...data, deals: [], cashflow: [], audit: [] } });
    }
  });
  await page.goto("/dashboard");
  await expect(page.getByRole("status", { name: "Loading cash flow" })).toBeVisible();
  respond();
  const error = page.getByRole("alert").filter({ hasText: "Could not load cash flow data." });
  await expect(error).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByText("No deals in USD yet. Create a deal to see its cash flow here."),
  ).toBeVisible();
  await expect(error).toHaveCount(0);
});

test("dashboard assistant displays a scripted response without a provider call", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/dashboard/llm", async (route) => {
    requests++;
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      json: {
        id: "offline-dashboard-turn",
        text: "Your USD cash flow is shown separately from other currencies.",
        toolCalls: [],
      },
    });
  });
  await page.goto("/dashboard");
  await expect(page.getByText("Held by PayPal", { exact: true }).first()).toBeVisible();
  const input = page.getByRole("textbox", { name: "Message input" });
  if (!(await input.isVisible()))
    await page.getByRole("button", { name: "AI Assistant", exact: true }).click();
  await input.fill("Explain the current cash flow currency.");
  await input.press("Enter");
  await expect(
    page.getByText("Your USD cash flow is shown separately from other currencies.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(requests).toBeGreaterThan(0);
});
