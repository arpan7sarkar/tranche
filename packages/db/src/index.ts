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
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle"),
  });
}

export * from "./magic-links";
export * from "./negotiation-plan";
export * from "./sandbox-store";
export { schema };
