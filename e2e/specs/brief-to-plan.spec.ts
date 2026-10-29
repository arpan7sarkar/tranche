import { expect, test } from "../support/browser";
import { STAGING } from "../support/state";

test("an agency submits a brief, reviews a scripted draft, and saves the Gantt", async ({
  page,
}) => {
  await page.goto("/deals/new");
  await page.getByLabel("Project title").fill("Browser planned storefront");
  await page.getByLabel("Client name", { exact: true }).fill("Planning client");
  await page.getByLabel("Client email").fill("planning@client.test");
  await page.getByLabel("Staging URL").fill(`${STAGING}/good`);
  await page
    .getByLabel("Project brief")
    .fill(
      "Build a storefront with product details, an add-to-cart control, and a working checkout page.",
    );
  await page.getByRole("button", { name: "Draft plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your draft" })).toBeVisible();
  await expect(page.getByLabel("Price (USD)")).toHaveValue("1800.00");
  await page.getByLabel("Milestone title").fill("Reviewed storefront");
  await page.getByRole("button", { name: "Save draft and open Gantt" }).click();
  await expect(page).toHaveURL(/\/deals\/[a-f0-9-]{36}$/);
  await expect(page.getByTestId("milestone-build")).toContainText("Reviewed storefront");
  await expect(page.getByTestId("deal-status")).toHaveAttribute("data-status", "draft");
  await page.reload();
  await expect(page.getByTestId("milestone-build")).toContainText("Reviewed storefront");
});
