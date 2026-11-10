import { migrateDb } from "@tranche/db";
import { openFixtureDb } from "../support/database";
import { appEnv } from "../support/environment";
import { seedE2E } from "../support/seed-e2e";
import { writeState } from "../support/state";

export default async function globalSetup() {
  Object.assign(process.env, appEnv);
  const db = await openFixtureDb();
  try {
    await migrateDb(db);
    writeState(await seedE2E(db));
  } finally {
    await db.$client.end();
  }
}
