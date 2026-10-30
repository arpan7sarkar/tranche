import { createDb, migrateDb } from "../src/index";

if (process.env.DATABASE_SSL !== "verify-full")
  throw new Error("deployment_migration_requires_verified_tls");
const db = createDb();
try {
  await migrateDb(db);
  console.log("Deployment migrations applied");
} finally {
  await db.$client.end();
}
