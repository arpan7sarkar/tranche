import { createDb } from "@tranche/db";
import { openSandboxTestDb } from "@tranche/db/testing";
import { databaseUrl, testDatabase } from "./environment";

export async function openFixtureDb() {
  const owned = await openSandboxTestDb(testDatabase);
  await owned.$client.end();
  return createDb(databaseUrl);
}
