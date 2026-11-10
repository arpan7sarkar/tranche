import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(postgres(url), { schema, casing: "snake_case" });
}

export type Db = ReturnType<typeof createDb>;

export async function migrateDb(db: Db) {
  // Drizzle's migrator checks the migration journal and applies missing migrations in a
  // transaction, but concurrent test workers can both observe a migration as unapplied.
  // Hold a database-scoped advisory lock on the very connection used by the migrator so
  // multiple processes sharing a test database serialize this check-and-apply sequence.
  const client = db.$client;
  const connection = await client.reserve();
  try {
    await connection`select pg_advisory_lock(hashtext(current_database()), hashtext('tranche:drizzle:migrations'))`;
    const migrationDb = drizzle(connection, { schema, casing: "snake_case" });
    await migrate(migrationDb, {
      migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle"),
    });
  } finally {
    try {
      await connection`select pg_advisory_unlock(hashtext(current_database()), hashtext('tranche:drizzle:migrations'))`;
    } finally {
      connection.release();
    }
  }
}

export * from "./magic-links";
export * from "./negotiation-plan";
export * from "./sandbox-store";
export { schema };
