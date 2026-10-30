import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

export function databaseTlsOptions(connectionString = process.env.DATABASE_URL) {
  if (process.env.DATABASE_SSL !== "verify-full") return undefined;
  const url = new URL(connectionString ?? "");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) throw new Error("verified_database_tls_requires_dns_hostname");
  if ([...url.searchParams.keys()].some((key) => key.toLowerCase().startsWith("ssl")))
    throw new Error("database_url_tls_overrides_forbidden");
  const ca =
    process.env.DATABASE_CA_CERT?.replaceAll("\\n", "\n") ??
    (process.env.DATABASE_CA_FILE ? readFileSync(process.env.DATABASE_CA_FILE, "utf8") : undefined);
  return { rejectUnauthorized: true, servername: hostname, ...(ca ? { ca } : {}) };
}

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const max = Number(process.env.DATABASE_POOL_MAX || (process.env.VERCEL ? 2 : 10));
  if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error("invalid_database_pool_max");
  const ssl = databaseTlsOptions(url);
  return drizzle(
    postgres(url, {
      max,
      idle_timeout: 20,
      connect_timeout: 10,
      ...(ssl ? { ssl } : {}),
    }),
    { schema, casing: "snake_case" },
  );
}

export type Db = ReturnType<typeof createDb>;

export async function migrateDb(db: Db) {
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle"),
  });
}

export * from "./magic-links";
export * from "./negotiation-plan";
export * from "./sandbox-store";
export { schema };
