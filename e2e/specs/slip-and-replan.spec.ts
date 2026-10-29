import { expect, test } from "../support/browser";
import { readState } from "../support/state";

test("moving a task shifts the milestone dates and its funding timer", async ({ page }) => {
  const { slip } = readState();
  await page.goto(`/deals/${slip.dealId}`);
  const snapshot = async () => {
    const response = await page.request.get(`/api/deals/${slip.dealId}`);
    expect(response.ok()).toBe(true);
    return (await response.json()) as {
      tasks: { key: string; startDate: string; durationDays: number }[];
      milestones: { startDate: string; endDate: string; fundDueAt: string }[];
    };
  };
  const before = await snapshot();
  const design = before.tasks.find((task) => task.key === "design");
  expect(design).toBeDefined();
  const base = Date.parse(`${design?.startDate}T00:00:00Z`) - 7 * 86400000;
  const date = (days: number) => new Date(base + days * 86400000).toISOString().slice(0, 10);
  expect(before.tasks.find((task) => task.key === "build")).toMatchObject({
    startDate: date(12),
    durationDays: 5,
  });
  expect(before.milestones[0]).toMatchObject({ startDate: date(7), endDate: date(17) });
  expect(before.milestones[0]?.fundDueAt.slice(0, 10)).toBe(date(4));

  const dates = page.getByTestId("milestone-dates-work");
  const fund = page.getByTestId("scheduled-fund-work");
  const datesBefore = await dates.textContent();
  const fundBefore = await fund.textContent();

  await page.getByTestId("edit-task-design").click();
  const start = page.getByTestId("task-start-input");
  const current = await start.inputValue();
  const later = new Date(Date.parse(`${current}T00:00:00Z`) + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await start.fill(later);
  await page.getByTestId("save-task").click();

  await expect(dates).not.toHaveText(datesBefore ?? "");
  await expect(fund).not.toHaveText(fundBefore ?? "");
  await page.reload();
  await expect(dates).not.toHaveText(datesBefore ?? "");
  const after = await snapshot();
  expect(after.tasks.find((task) => task.key === "design")?.startDate).toBe(date(14));
  expect(after.tasks.find((task) => task.key === "build")?.startDate).toBe(date(19));
  expect(after.milestones[0]).toMatchObject({ startDate: date(14), endDate: date(24) });
  expect(after.milestones[0]?.fundDueAt.slice(0, 10)).toBe(date(11));
});
