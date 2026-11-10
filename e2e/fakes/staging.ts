import { createServer } from "node:http";

const GOOD = `<!doctype html><html><head><title>Acme Coffee</title></head><body>
<h1>Acme Coffee - Ethiopia Yirgacheffe</h1><p>$18.00 - 24 in stock</p><button>Add to cart</button>
<a href="/checkout">Checkout: Pay with PayPal</a></body></html>`;

export function startStagingSite(port: number) {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/pagespeedonline/v5/runPagespeed")) {
      res.setHeader("Content-Type", "application/json");
      const url = new URL(req.url, "http://localhost");
      return res.end(
        JSON.stringify({
          lighthouseResult: {
            finalUrl: url.searchParams.get("url"),
            categories: { [url.searchParams.get("category") ?? "performance"]: { score: 0.96 } },
          },
        }),
      );
    }
    if (req.url?.startsWith("/good")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(GOOD);
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });
  return new Promise<{ host: string; port: number; close(): Promise<void> }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("staging_not_listening"));
      resolve({
        host: address.address,
        port: address.port,
        close: () =>
          new Promise<void>((done, fail) =>
            server.close((error) => (error ? fail(error) : done())),
          ),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startStagingSite(Number(process.env.STAGING_PORT ?? 4020));
  console.log("staging ready");
}
