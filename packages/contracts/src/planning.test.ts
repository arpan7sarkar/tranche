import { expect, it } from "vitest";
import { StagingUrl } from "./planning";

it("rejects Figma references as website verification targets", () => {
  for (const host of ["figma.com", "www.figma.com", "embed.figma.com"]) {
    const result = StagingUrl.safeParse(`https://${host}/design/abc/portfolio`);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("deployed website");
  }
});
it("accepts deployed sites and keeps credential restrictions", () => {
  for (const url of [
    "https://portfolio.example.com",
    "https://portfolio.figma.site",
    "http://localhost:3000",
  ]) {
    expect(StagingUrl.safeParse(url).success).toBe(true);
  }
  expect(StagingUrl.safeParse("https://user:password@portfolio.example.com").success).toBe(false);
});

it("accepts a brief without a reference or deployment URL", async () => {
  const { DraftRequest, planningTargets } = await import("./planning");
  const input = DraftRequest.parse({
    requestId: crypto.randomUUID(),
    title: "Portfolio",
    clientName: "Client",
    clientEmail: "client@example.com",
    brief: "Build a portfolio with accessible project pages and a contact form.",
    repo: null,
    startDate: "2026-11-12",
  });
  expect(input.referenceUrl).toBeNull();
  expect(input.stagingUrl).toBeNull();
  expect(
    DraftRequest.parse({ ...input, referenceUrl: "https://www.figma.com/design/abc" }).referenceUrl,
  ).toContain("figma.com");
  expect(planningTargets({ stagingUrl: "https://www.figma.com/design/abc" })).toEqual({
    stagingUrl: null,
    referenceUrl: "https://www.figma.com/design/abc",
  });
});
