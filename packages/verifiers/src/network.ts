import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

export class UnsafeUrlError extends Error {}
export class InfrastructureError extends Error {}
export type Resolver = (host: string) => Promise<Array<{ address: string }>>;
export const defaultResolve: Resolver = (host) => lookup(host, { all: true, verbatim: true });
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? blocked.check(address, "ipv4")
    : family !== 6 || !globalV6.check(address, "ipv6") || blocked.check(address, "ipv6");
}
function testLocal(url: URL) {
  return (
    process.env.NODE_ENV === "test" &&
    process.env.VERIFIER_ALLOW_TEST_LOCALHOST === "1" &&
    url.protocol === "http:" &&
    url.hostname === "localhost" &&
    url.port === "4020"
  );
}
export async function publicTarget(raw: string, resolve: Resolver = defaultResolve) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    raw.length > 2000
  )
    throw new UnsafeUrlError("Unsafe URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (testLocal(url)) return { url, address: "127.0.0.1", family: 4 };
  if (url.port && !["80", "443"].includes(url.port)) throw new UnsafeUrlError("Non-standard port");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await Promise.race([
        resolve(host),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new InfrastructureError("DNS timeout")), 5000);
          timer.unref();
        }),
      ]);
  const first = addresses[0];
  if (!first || addresses.some(({ address }) => isBlockedAddress(address)))
    throw new UnsafeUrlError("Non-public destination");
  return { url, address: first.address, family: isIP(first.address) };
}
export async function assertPublicUrl(raw: string, resolve?: Resolver): Promise<URL> {
  return (await publicTarget(raw, resolve)).url;
}
export type SafeResponse = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};
export type SafeFetch = (
  url: string,
  options?: { redirects?: number; maxBytes?: number },
) => Promise<SafeResponse>;

export async function safeFetch(
  raw: string,
  options: { redirects?: number; maxBytes?: number; resolve?: Resolver } = {},
): Promise<SafeResponse> {
  let target = raw;
  const redirects = options.redirects ?? 4;
  for (let hop = 0; hop <= redirects; hop++) {
    const { url, address, family } = await publicTarget(target, options.resolve);
    const result = await new Promise<SafeResponse>((resolve, reject) => {
      const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          method: "GET",
          agent: false,
          headers: { "user-agent": "Tranche-Verifier", "accept-encoding": "identity" },
          lookup: (_host, opts, callback) =>
            opts.all ? callback(null, [{ address, family }]) : callback(null, address, family),
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > (options.maxBytes ?? 5_000_000)) {
              reject(new InfrastructureError("Response too large"));
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () =>
            resolve({
              url: url.href,
              status: response.statusCode ?? 502,
              headers: Object.fromEntries(
                Object.entries(response.headers).filter(
                  (entry): entry is [string, string] => typeof entry[1] === "string",
                ),
              ),
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      const timer = setTimeout(
        () => req.destroy(new InfrastructureError("Request timeout")),
        15000,
      );
      req.on("close", () => clearTimeout(timer));
      req.on("error", () => reject(new InfrastructureError("Destination unavailable")));
      req.end();
    });
    if (
      ![301, 302, 303, 307, 308].includes(result.status) ||
      !result.headers.location ||
      redirects === 0
    )
      return result;
    target = new URL(result.headers.location, target).href;
  }
  throw new UnsafeUrlError("Too many redirects");
}
