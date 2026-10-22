import { setTimeout as sleep } from "node:timers/promises";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { createDb, type Db, migrateDb, schema } from "./index";

export { openSandboxTestDb, sandboxTestOptions } from "./sandbox-test-db";

// 42P04 / 23505: the database exists, or a concurrent run created it first.
const EXISTS = new Set(["42P04", "23505"]);
// 55006: template1 is busy because another run is creating a database at the same moment.
const TEMPLATE_BUSY = "55006";

async function ensureDatabase(base: string, dbName: string): Promise<void> {
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await admin.unsafe(`create database "${dbName}"`);
        return;
      } catch (err) {
        const code = (err as { code?: string }).code ?? "";
        if (EXISTS.has(code)) return;
        if (code !== TEMPLATE_BUSY || attempt >= 20) throw err;
        await sleep(100 * attempt);
      }
    }
  } finally {
    await admin.end();
  }
}

// Every test run against one Postgres shares this database, so a test file holds an advisory
// lock on it from before migrating until it ends its client. Without it, two concurrent runs
// (two worktrees, or a watch beside a full run) truncate and insert under each other's tests.
export async function createTestDb(name: string, base = process.env.DATABASE_URL): Promise<Db> {
  if (!base) throw new Error("DATABASE_URL is not set");
  const dbName = `tranche_test_${name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  await ensureDatabase(base, dbName);
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  const lock = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await lock`select pg_advisory_lock(hashtext(${dbName}))`;
  const db = createDb(url.toString());
  const end = db.$client.end.bind(db.$client);
  db.$client.end = async (options) => {
    try {
      await end(options);
    } finally {
      await lock.end();
    }
  };
  await migrateDb(db);
  return db;
}

const TABLES = (Object.values(schema) as unknown[])
  .filter((t): t is PgTable => is(t, PgTable))
  .map((t) => `"${getTableName(t)}"`)
  .join(", ");

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql.raw(`truncate table ${TABLES} restart identity cascade`));
}
