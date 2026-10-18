import { createTestDb, openSandboxTestDb } from "@tranche/db/testing";

export async function createAgentTestDb(name: string) {
  const url = process.env.TEST_DATABASE_URL;
  const fixture = await openSandboxTestDb(url);
  await fixture.$client.end();
  return createTestDb(name, url);
}
