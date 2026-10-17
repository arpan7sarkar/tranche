import { migrateDb } from "../src/index";
import { openSandboxTestDb } from "../src/sandbox-test-db";

const db = await openSandboxTestDb(process.env.TEST_DATABASE_URL);
try {
  await migrateDb(db);
  console.log("Disposable F0 test database migrations applied");
} finally {
  await db.$client.end();
}
