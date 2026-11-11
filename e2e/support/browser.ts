import { type Browser, type BrowserContext, test as base, expect } from "@playwright/test";

export { expect };

async function guard(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const fakeApproval = /^\/api\/portal\/[^/]+\/orders\/([^/]+)\/fake-approve$/.exec(url.pathname);
    if (
      url.origin === "http://localhost:3100" &&
      !url.search &&
      route.request().method() === "POST" &&
      fakeApproval?.[1]
    ) {
      const orderId = encodeURIComponent(decodeURIComponent(fakeApproval[1]));
      const response = await context.request.post(
        `http://127.0.0.1:4010/__test/approve/${orderId}`,
        {
          maxRedirects: 0,
        },
      );
      return route.fulfill({ status: response.ok() ? 204 : 502 });
    }
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
