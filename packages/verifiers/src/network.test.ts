import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertPublicUrl, isBlockedAddress, publicTarget, safeFetch } from "./network";

it.each([
  "127.0.0.1",
  "10.0.0.1",
  "172.16.0.1",
  "169.254.169.254",
  "192.168.0.1",
  "100.64.0.1",
  "0.0.0.0",
  "224.0.0.1",
  "::1",
  "::",
  "::ffff:127.0.0.1",
  "64:ff9b::7f00:1",
  "fc00::1",
  "fe80::1",
  "2001:db8::1",
  "2002:7f00::1",
])("blocks reserved address %s", (address) => {
  expect(isBlockedAddress(address)).toBe(true);
});
it("rejects mixed DNS, numeric encodings, credentials and alternate protocols", async () => {
  await expect(
    assertPublicUrl("https://public.example", async () => [
      { address: "93.184.216.34" },
      { address: "127.0.0.1" },
    ]),
  ).rejects.toThrow("Non-public");
  for (const url of [
    "http://2130706433",
    "http://0x7f000001",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "http://[::ffff:127.0.0.1]",
  ])
    await expect(assertPublicUrl(url)).rejects.toThrow();
  expect(
    (await publicTarget("https://example.com", async () => [{ address: "93.184.216.34" }])).address,
  ).toBe("93.184.216.34");
});
describe("guarded local HTTP transport", () => {
  const server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "http://127.0.0.1:4020/private" });
      res.end();
    } else if (req.url === "/large") res.end("x".repeat(200));
    else res.end("safe test page");
  });
  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERIFIER_ALLOW_TEST_LOCALHOST", "1");
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(4020, "127.0.0.1", resolve);
    });
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });
  it("fetches only the exact test endpoint and rejects redirected private destinations", async () => {
    expect((await safeFetch("http://localhost:4020")).body.toString()).toBe("safe test page");
    await expect(safeFetch("http://localhost:4020/redirect")).rejects.toThrow("Non-standard port");
    await expect(safeFetch("http://localhost:4020/large", { maxBytes: 100 })).rejects.toThrow();
    await expect(assertPublicUrl("http://localhost:4021")).rejects.toThrow();
  });
  it("does not allow the local exception in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(assertPublicUrl("http://localhost:4020")).rejects.toThrow();
    vi.stubEnv("NODE_ENV", "test");
  });
});
