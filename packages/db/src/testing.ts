import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { createDb, type Db, migrateDb, schema } from "./index";

export async function createTestDb(name: string): Promise<Db> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  const dbName = `tranche_test_${name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${dbName}"`);
  } catch (err) {
    // 42P04: the database already exists from an earlier run.
    if ((err as { code?: string }).code !== "42P04") throw err;
  } finally {
    await admin.end();
  }
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  const db = createDb(url.toString());
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
