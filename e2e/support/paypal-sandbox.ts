import { expect, type Page } from "@playwright/test";
export async function approveWithPayPal(page: Page, begin: () => Promise<void>) {
  await begin();
  const approve = page.getByTestId("fake-paypal-approve");
  const fund = page.getByTestId("fund-work");
  await expect
    .poll(async () => {
      if (await approve.isVisible()) return true;
      if ((await fund.isVisible()) && (await fund.isEnabled())) await fund.click();
      return approve.isVisible();
    })
    .toBe(true);
  await expect(approve).toBeVisible();
  await approve.click();
}
