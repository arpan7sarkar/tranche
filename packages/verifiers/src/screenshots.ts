import { chromium } from "playwright";
import { assertPublicUrl, type SafeFetch, safeFetch, UnsafeUrlError } from "./network";

export type Shot = { url: string; viewport: "desktop" | "mobile"; base64: string; text: string };
export async function captureScreenshots(
  urls: string[],
  fetchPage: SafeFetch = safeFetch,
): Promise<Shot[]> {
  if (urls.length > 4) throw new UnsafeUrlError("At most four screenshot pages are supported");
  for (const url of urls) await assertPublicUrl(url);
  const browser = await chromium.launch({
    args: [
      "--disable-background-networking",
      "--disable-webrtc",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  });
  try {
    const shots: Shot[] = [];
    for (const url of [...new Set(urls)])
      for (const viewport of ["desktop", "mobile"] as const) {
        const context = await browser.newContext({
          viewport:
            viewport === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
          serviceWorkers: "block",
          acceptDownloads: false,
        });
        try {
          let requests = 0;
          let bytes = 0;
          let unsafe = false;
          await context.routeWebSocket("**/*", (socket) => socket.close());
          await context.route("**/*", async (route) => {
            try {
              if (++requests > 100 || route.request().method() !== "GET") {
                await route.abort();
                return;
              }
              const response = await fetchPage(route.request().url(), {
                redirects: 0,
                maxBytes: 2_000_000,
              });
              bytes += response.body.length;
              if (bytes > 15_000_000) throw new Error("Page resource budget exceeded");
              const headers = { ...response.headers };
              delete headers["set-cookie"];
              delete headers["content-encoding"];
              delete headers["transfer-encoding"];
              delete headers["content-length"];
              await route.fulfill({ status: response.status, headers, body: response.body });
            } catch (error) {
              if (error instanceof UnsafeUrlError) unsafe = true;
              await route.abort().catch(() => {});
            }
          });
          const page = await context.newPage();
          const response = await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
          if (!response?.ok()) throw new Error("Screenshot page unavailable");
          await assertPublicUrl(page.url());
          const image = await page.screenshot({ type: "jpeg", quality: 65, timeout: 5000 });
          if (unsafe) throw new UnsafeUrlError("Page requested a non-public subresource");
          shots.push({
            url: page.url(),
            viewport,
            base64: image.toString("base64"),
            text: (await page.locator("body").innerText({ timeout: 5000 })).slice(0, 5000),
          });
        } finally {
          await context.close();
        }
      }
    return shots;
  } finally {
    await browser.close();
  }
}
