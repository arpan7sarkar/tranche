import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { reservePorts } from "../support/ports";

if (process.env.DATABASE_URL !== undefined || process.env.TEST_DATABASE_URL !== undefined)
  throw new Error("inherited_database_url_forbidden");
if (process.env.NODE_OPTIONS !== undefined) throw new Error("inherited_node_options_forbidden");

const path = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
const browserPath =
  process.env.PLAYWRIGHT_BROWSERS_PATH ??
  (process.env.HOME ? join(process.env.HOME, ".cache", "ms-playwright") : undefined);
const home = mkdtempSync(join(tmpdir(), "tranche-e2e-"));
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, {
  PATH: path,
  HOME: home,
  DOCKER_HOST: "unix:///var/run/docker.sock",
  COREPACK_ENABLE_NETWORK: "0",
  ...(browserPath ? { PLAYWRIGHT_BROWSERS_PATH: browserPath } : {}),
});
const docker = (...args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const marker = randomBytes(16).toString("hex");
const password = randomBytes(16).toString("hex");
const name = `tranche-e2e-${marker}`;
let containerId = "";
let child: ReturnType<typeof spawn> | undefined;
let interrupted = false;
let releasePorts: (() => Promise<void>) | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    interrupted = true;
    child?.kill(signal);
  });
}

try {
  releasePorts = await reservePorts([3100, 4010, 4020, 4030]);
  const imageId = docker("image", "inspect", "--format", "{{.Id}}", "postgres:18");
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("invalid_e2e_image");
  containerId = docker(
    "run",
    "-d",
    "--pull=never",
    "--name",
    name,
    "--label",
    `tranche.e2e.marker=${marker}`,
    "--memory",
    "512m",
    "--tmpfs",
    "/var/lib/postgresql:rw,size=256m",
    "-p",
    "127.0.0.1::5432",
    "-e",
    "POSTGRES_USER=tranche_e2e",
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-e",
    "POSTGRES_DB=postgres",
    "postgres:18",
    "postgres",
    "-c",
    `tranche.e2e_fixture=${marker}`,
  );
  if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("invalid_e2e_container_id");
  let ready = false;
  for (let i = 0; i < 60 && !interrupted; i++) {
    try {
      docker(
        "exec",
        containerId,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "tranche_e2e",
        "-d",
        "postgres",
      );
      ready = true;
      break;
    } catch {
      await delay(1_000);
    }
  }
  if (!ready) throw new Error("e2e_database_not_ready");
  const binding = /^127\.0\.0\.1:(\d+)$/.exec(docker("port", containerId, "5432/tcp"));
  if (!binding?.[1]) throw new Error("invalid_e2e_database_binding");
  Object.assign(process.env, {
    TRANCHE_E2E_CONTAINER_ID: containerId,
    TRANCHE_E2E_IMAGE_ID: imageId,
    TRANCHE_E2E_MARKER: marker,
    TRANCHE_E2E_DB_PORT: binding[1],
    TRANCHE_E2E_DB_PASSWORD: password,
  });
  const guard = fileURLToPath(new URL("../support/network-guard.cjs", import.meta.url));
  await import(guard);
  process.env.NODE_OPTIONS = `--require=${guard}`;
  const { default: setup } = await import("./global-setup");
  await setup();
  await releasePorts();
  releasePorts = undefined;
  const cli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
  child = spawn(process.execPath, [cli, "test", ...process.argv.slice(2)], {
    env: process.env,
    stdio: "inherit",
  });
  const exit = await new Promise<number>((resolve, reject) => {
    child?.once("error", reject);
    child?.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = interrupted ? 1 : exit;
} catch (error) {
  console.error(error instanceof Error ? error.message : "e2e_launcher_failed");
  process.exitCode = 1;
} finally {
  if (releasePorts) {
    await releasePorts().catch(() => {
      console.error("e2e_port_release_failed");
      process.exitCode = 1;
    });
  }
  if (/^[a-f0-9]{64}$/.test(containerId)) {
    try {
      const [container] = JSON.parse(docker("inspect", containerId));
      if (
        container.Id === containerId &&
        container.Name === `/${name}` &&
        container.Config.Labels?.["tranche.e2e.marker"] === marker
      ) {
        docker("rm", "-f", containerId);
      } else {
        console.error("e2e_cleanup_ownership_mismatch");
        process.exitCode = 1;
      }
    } catch {
      console.error("e2e_owned_container_cleanup_failed");
      process.exitCode = 1;
    }
  }
}
