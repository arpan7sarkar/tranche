import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateImages } from "./validate-images.mjs";

const compose = fileURLToPath(new URL("./compose.yml", import.meta.url));
const env = {
  PATH: process.env.PATH,
  HOME: "/nonexistent",
  TRANCHE_PROJECT_NAME: "tranche-ci-test",
  TRANCHE_POSTGRES_IMAGE: `postgres@sha256:${"a".repeat(64)}`,
  TRANCHE_POSTGRES_PASSWORD_FILE: "/nonexistent/tranche-placeholder",
  TRANCHE_WEB_IMAGE: `web@sha256:${"b".repeat(64)}`,
  TRANCHE_SCHEDULER_IMAGE: `scheduler@sha256:${"c".repeat(64)}`,
  TRANCHE_MIGRATION_IMAGE: `migration@sha256:${"d".repeat(64)}`,
  TRANCHE_WEB_ENV_FILE: "/nonexistent/web-placeholder",
  TRANCHE_SCHEDULER_ENV_FILE: "/nonexistent/scheduler-placeholder",
  TRANCHE_MIGRATION_ENV_FILE: "/nonexistent/migration-placeholder",
};
const migration = fileURLToPath(new URL("./compose.migration.yml", import.meta.url));
const config = (withMigration, ...args) =>
  JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        "/dev/null",
        "-f",
        compose,
        ...(withMigration ? ["-f", migration] : []),
        ...args,
        "config",
        "--format",
        "json",
      ],
      { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );

validateImages(env);
for (const name of [
  "TRANCHE_POSTGRES_IMAGE",
  "TRANCHE_WEB_IMAGE",
  "TRANCHE_SCHEDULER_IMAGE",
  "TRANCHE_MIGRATION_IMAGE",
]) {
  assert.throws(() => validateImages({ ...env, [name]: "example:latest" }));
  assert.throws(() => validateImages({ ...env, [name]: "example@sha256:abc" }));
  const local = { ...env, [name]: `sha256:${"e".repeat(64)}` };
  assert.throws(() => validateImages(local));
  validateImages(local, "local");
}

const inactive = config(false);
assert.deepEqual(Object.keys(inactive.services ?? {}), []);

const active = config(false, "--profile", "database");
assert.deepEqual(Object.keys(active.services), ["postgres"]);
const postgres = active.services.postgres;
assert.deepEqual(postgres.profiles, ["database"]);
assert.equal(postgres.image, env.TRANCHE_POSTGRES_IMAGE);
assert.equal(postgres.restart, "no");
assert.equal(postgres.pull_policy, "never");
assert.equal(postgres.ports?.length ?? 0, 0);
assert.deepEqual(Object.keys(postgres.networks), ["database"]);
assert.equal(active.networks.database.internal, true);
assert.equal(postgres.environment.POSTGRES_PASSWORD_FILE, "/run/secrets/postgres_password");
assert.equal(postgres.secrets?.[0]?.source, "postgres_password");
assert.deepEqual(postgres.healthcheck.test, [
  "CMD-SHELL",
  "pg_isready -h 127.0.0.1 -U tranche -d tranche",
]);
assert.equal(active.secrets.postgres_password.file, env.TRANCHE_POSTGRES_PASSWORD_FILE);
const app = config(false, "--profile", "database", "--profile", "web", "--profile", "scheduler");
assert.ok(
  !Object.hasOwn(app.services, "web"),
  "shared proxy must not receive the generic web alias",
);
assert.deepEqual(Object.keys(app.services).sort(), ["postgres", "scheduler", "tranche-web"]);
const full = config(
  true,
  "--profile",
  "database",
  "--profile",
  "web",
  "--profile",
  "scheduler",
  "--profile",
  "migration",
);
assert.deepEqual(Object.keys(full.services).sort(), [
  "migration",
  "postgres",
  "scheduler",
  "tranche-web",
]);
for (const [name, cpus, memory, pids] of [
  ["postgres", 0.75, "536870912", 128],
  ["tranche-web", 0.5, "536870912", 128],
  ["scheduler", 1, "805306368", 256],
  ["migration", 0.5, "402653184", 96],
]) {
  assert.equal(Number(full.services[name].cpus), cpus);
  assert.equal(String(full.services[name].mem_limit), memory);
  assert.equal(String(full.services[name].memswap_limit), memory);
  assert.equal(Number(full.services[name].pids_limit), pids);
}
for (const [name, profile] of [
  ["tranche-web", "web"],
  ["scheduler", "scheduler"],
  ["migration", "migration"],
]) {
  const service = full.services[name];
  assert.deepEqual(service.profiles, [profile]);
  assert.equal(service.restart, "no");
  assert.equal(service.pull_policy, "never");
  assert.match(service.image, /@sha256:[a-f0-9]{64}$/);
}
assert.deepEqual(full.services["tranche-web"].command, [
  "node",
  "--env-file=/run/secrets/web_env",
  "apps/web/server.js",
]);
assert.equal(full.services["tranche-web"].environment.WEB_MONEY_ENABLED, "false");
assert.equal(full.services["tranche-web"].environment.PAYPAL_ENV, "sandbox");
assert.deepEqual(full.services.scheduler.command, [
  "node",
  "--env-file=/run/secrets/scheduler_env",
  "apps/agents/dist/vps/index.mjs",
]);
assert.equal(full.services.scheduler.environment.VPS_MONEY_ENABLED, "0");
assert.equal(full.services.scheduler.environment.PAYPAL_ENV, "sandbox");
assert.equal(full.services.scheduler.init, true);
assert.equal(full.services.scheduler.stop_grace_period, "45s");
assert.deepEqual(full.services.migration.command, [
  "node",
  "--env-file=/run/secrets/migration_env",
  "/usr/local/bin/pnpm",
  "--filter",
  "@tranche/db",
  "db:migrate",
]);
for (const [name, secret] of [
  ["tranche-web", "web"],
  ["scheduler", "scheduler"],
  ["migration", "migration"],
]) {
  assert.equal(full.services[name].secrets[0].source, `${secret}_env`);
  assert.equal(full.secrets[`${secret}_env`].file, env[`TRANCHE_${secret.toUpperCase()}_ENV_FILE`]);
}
assert.equal(full.services["tranche-web"].ports?.length ?? 0, 0);
assert.deepEqual(Object.keys(full.services["tranche-web"].networks).sort(), ["database", "proxy"]);
assert.ok(!(full.services["tranche-web"].networks.proxy?.aliases ?? []).includes("web"));
assert.equal(full.networks.proxy.external, true);
assert.equal(full.networks.proxy.name, "proxy");
assert.equal(full.services.scheduler.ports?.length ?? 0, 0);
assert.equal(full.services.migration.ports?.length ?? 0, 0);
assert.deepEqual(Object.keys(full.services.migration.networks), ["database"]);
console.log("Compose baseline checks passed");
