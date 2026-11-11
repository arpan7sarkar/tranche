import { createServer } from "node:net";
import { expect, it } from "vitest";
import { reservePorts } from "../support/ports";

it("rejects an occupied loopback port without disturbing its listener", async () => {
  const existing = createServer();
  await new Promise<void>((resolve, reject) => {
    existing.once("error", reject);
    existing.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = existing.address();
    if (!address || typeof address === "string") throw new Error("missing_listener_address");
    await expect(reservePorts([address.port])).rejects.toThrow("e2e_port_unavailable");
    expect(existing.listening).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      existing.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
