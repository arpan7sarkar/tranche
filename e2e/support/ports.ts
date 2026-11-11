import { createServer, type Server } from "node:net";

export async function reservePorts(ports: readonly number[]): Promise<() => Promise<void>> {
  const servers: Server[] = [];
  const close = async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
    servers.length = 0;
  };
  try {
    for (const port of ports) {
      for (const host of ["127.0.0.1", "::1"]) {
        const server = createServer();
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen({ port, host, ipv6Only: true }, resolve);
        });
        servers.push(server);
      }
    }
  } catch {
    await close();
    throw new Error("e2e_port_unavailable");
  }
  return close;
}
