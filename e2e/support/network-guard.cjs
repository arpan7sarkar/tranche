const net = require("node:net");
const { syncBuiltinESMExports } = require("node:module");

const hosts = new Set(["localhost", "127.0.0.1", "::1"]);
const ports = new Set([3100, 4010, 4020, 4030, 4031, 55432]);
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
