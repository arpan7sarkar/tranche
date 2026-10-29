import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const guard = fileURLToPath(new URL("../support/network-guard.cjs", import.meta.url));

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
