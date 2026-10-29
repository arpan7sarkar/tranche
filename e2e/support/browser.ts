import { type Browser, type BrowserContext, test as base, expect } from "@playwright/test";

export { expect };

async function guard(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      ["3100", "4010", "4020", "4030"].includes(url.port)
    )
      return route.continue();
    await route.abort("blockedbyclient");
    throw new Error(`offline_browser_destination_blocked:${url.origin}`);
  });
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await guard(context);
    await use(context);
  },
});

export async function clientContext(browser: Browser) {
  const context = await browser.newContext({
    baseURL: "http://localhost:3100",
    serviceWorkers: "block",
  });
  await guard(context);
  return context;
}
