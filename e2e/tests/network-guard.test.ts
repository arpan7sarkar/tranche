import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const guard = fileURLToPath(new URL("../support/network-guard.cjs", import.meta.url));

it("routes only the canonical sandbox origin to the local fake and preserves requests", async () => {
  const server = createServer(async (req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "https://api.resend.com/emails" });
      return res.end();
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ method: req.method, url: req.url, header: req.headers["x-test"], body }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected loopback address");
  try {
    const { stdout } = await exec(
      process.execPath,
      [
        "--require",
        guard,
        "-e",
        `
      (async () => {
        if (process.env.TRANCHE_E2E_PAYPAL_FAKE_PORT !== '4010') {
          try { require('node:net').connect(4010, '127.0.0.1'); throw new Error('default port still allowed'); }
          catch (error) { if (error.code !== 'OFFLINE_NETWORK_BLOCKED') throw error; }
        }
        for (const url of ['http://api-m.sandbox.paypal.com/v1/test', 'https://api-m.sandbox.paypal.com.evil.test/v1/test', 'https://api-m.sandbox.paypal.com:444/v1/test']) {
          try { await fetch(url); throw new Error('unexpected external access'); }
          catch (error) { if (error.cause?.code !== 'OFFLINE_NETWORK_BLOCKED') throw error; }
        }
        for (const redirect of ['follow', 'error']) {
          try { await fetch('https://api-m.sandbox.paypal.com/redirect', { redirect }); throw new Error('unexpected redirect'); }
          catch (error) {
            if (error.message === 'unexpected redirect') throw error;
            if (redirect === 'follow' && error.cause?.code !== 'OFFLINE_NETWORK_BLOCKED') throw error;
          }
        }
        const request = new Request('https://api-m.sandbox.paypal.com/v1/test?q=1', {
          method: 'POST', headers: { 'x-test': 'value' }, body: 'payload', redirect: 'error'
        });
        const response = await fetch(request);
        console.log(await response.text());
      })();
      `,
      ],
      { env: { ...process.env, TRANCHE_E2E_PAYPAL_FAKE_PORT: String(address.port) } },
    );
    expect(JSON.parse(stdout)).toEqual({
      method: "POST",
      url: "/v1/test?q=1",
      header: "value",
      body: "payload",
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("blocks external fetch and raw sockets before connecting", async () => {
  const { stdout } = await exec(process.execPath, [
    "--require",
    guard,
    "-e",
    `
    const net = require('node:net');
    try { net.connect(443, 'api.paypal.com'); process.exit(1); }
    catch (e) { if (e.code !== 'OFFLINE_NETWORK_BLOCKED') throw e; }
    fetch('https://api.openai.com/v1/models').then(() => process.exit(1)).catch(e => {
      if (e.cause?.code !== 'OFFLINE_NETWORK_BLOCKED') throw e;
      console.log('blocked');
    });
  `,
  ]);
  expect(stdout.trim()).toBe("blocked");
});

it("permits local fake traffic but blocks a redirect to an external host", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/redirect") res.writeHead(302, { Location: "https://api.resend.com/emails" });
    res.end("local");
  });
  await new Promise<void>((resolve) => server.listen(4031, "127.0.0.1", resolve));
  try {
    const { stdout } = await exec(process.execPath, [
      "--require",
      guard,
      "-e",
      `
      (async () => {
        const response = await fetch('http://127.0.0.1:4031');
        if (await response.text() !== 'local') process.exit(1);
        try { await fetch('http://127.0.0.1:4031/redirect'); process.exit(1); }
        catch (e) { if (e.cause?.code !== 'OFFLINE_NETWORK_BLOCKED') throw e; }
        console.log('isolated');
      })();
    `,
    ]);
    expect(stdout.trim()).toBe("isolated");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
