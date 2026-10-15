import { createDb, migrateDb } from "../src/index";

const value = process.env.TEST_DATABASE_URL;
if (!value) throw new Error("TEST_DATABASE_URL is required");
const url = new URL(value);
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.port !== "55432" ||
  url.pathname !== "/tranche_p2_test"
) {
  throw new Error("Use only the disposable local tranche_p2_test database on port 55432");
}

const db = createDb(value);
try {
  await migrateDb(db);
  console.log("Disposable F0 test database migrations applied");
} finally {
  await db.$client.end();
}
