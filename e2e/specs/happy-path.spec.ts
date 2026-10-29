import { clientContext, expect, test } from "../support/browser";
import { approveWithPayPal } from "../support/paypal-sandbox";
import { readState, STAGING } from "../support/state";

test("reviewed plan to paid out: fund, deliver, verify, release", async ({ page, browser }) => {
  const { happy } = readState();

  await page.goto(`/deals/${happy.dealId}`);
  await page.getByTestId("send-plan").click();
  await expect(page.getByTestId("deal-status")).toHaveAttribute("data-status", "sent");

  const client = await (await clientContext(browser)).newPage();
  await client.goto(`/portal/${happy.portalToken}`);
  await approveWithPayPal(client, () => client.getByTestId("approve-plan").click());

  await expect(page.getByTestId("milestone-work")).toHaveAttribute("data-state", "held");

  await page.getByTestId("mark-delivered-work").click();
  await page.getByTestId("delivery-url-input").fill(`${STAGING}/good`);
  await page.getByTestId("delivery-notes-input").fill("Delivered the agreed storefront.");
  await page.getByTestId("submit-delivery").click();

  await expect(page.getByTestId("milestone-work")).toHaveAttribute("data-state", "release_pending");
  await expect(page.getByTestId("evidence-work")).toContainText(/lighthouse/i);

  await client.reload();
  await client.getByTestId("release-work").click();
  await expect(client.getByTestId("milestone-work")).toHaveAttribute("data-state", "paid_out");
  await expect(page.getByTestId("milestone-work")).toHaveAttribute("data-state", "paid_out");
});
