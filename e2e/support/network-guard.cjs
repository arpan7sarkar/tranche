const net = require("node:net");

const fakePort = Number(process.env.TRANCHE_E2E_PAYPAL_FAKE_PORT ?? "4010");
if (!Number.isInteger(fakePort) || fakePort < 1 || fakePort > 65535)
  throw new Error("invalid_e2e_paypal_fake_port");

const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  let url;
  try {
    url = new URL(input instanceof Request ? input.url : input);
  } catch {
    return originalFetch(input, init);
  }
  if (url.origin !== "https://api-m.sandbox.paypal.com" || url.username || url.password)
    return originalFetch(input, init);
  const request = new Request(input, init);
  url.protocol = "http:";
  url.hostname = "127.0.0.1";
  url.port = String(fakePort);
  return originalFetch(new Request(url, request));
};
const { syncBuiltinESMExports } = require("node:module");

const hosts = new Set(["localhost", "127.0.0.1", "::1"]);
const ports = new Set([3100, fakePort, 4020, 4030, 4031]);
if (process.env.TRANCHE_E2E_DB_PORT !== undefined) {
  const dbPort = Number(process.env.TRANCHE_E2E_DB_PORT);
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535 || dbPort === 55432)
    throw new Error("invalid_e2e_db_port");
  ports.add(dbPort);
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const first = values[0];
  const options =
    typeof first === "object"
      ? first
      : {
          port: first,
          host: typeof values[1] === "string" ? values[1] : "localhost",
        };
  if (
    !options ||
    options.path ||
    !hosts.has(options.host || "localhost") ||
    !ports.has(Number(options.port))
  ) {
    const error = new Error("offline_network_destination_blocked");
    error.code = "OFFLINE_NETWORK_BLOCKED";
    throw error;
  }
  return connect.apply(this, args);
};
syncBuiltinESMExports();
