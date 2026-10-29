import { createTestDb, openSandboxTestDb, truncateAll } from "@tranche/db/testing";
import { appEnv, testDatabase } from "../support/environment";
import { seedE2E } from "../support/seed-e2e";
import { writeState } from "../support/state";
export default async function globalSetup() {
  Object.assign(process.env, appEnv);
  const owned = await openSandboxTestDb(testDatabase);
  await owned.$client.end();
  const db = await createTestDb("e2e", testDatabase);
  try {
    await truncateAll(db);
    writeState(await seedE2E(db));
  } finally {
    await db.$client.end();
  }
}
