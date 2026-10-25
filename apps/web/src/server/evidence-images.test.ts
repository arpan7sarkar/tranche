import assert from "node:assert/strict";
import { createAgentTestDb, makeDeal } from "@tranche/agents/testing";
import { type Db, schema } from "@tranche/db";
import { truncateAll } from "@tranche/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("./db", () => ({
  getDb: () => {
    assert(mocks.db);
    return mocks.db;
  },
}));

import { evidenceImageResponse } from "./evidence-images";

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("private screenshot access", () => {
  beforeAll(async () => {
    mocks.db = await createAgentTestDb("images");
    await truncateAll(mocks.db);
  });
  afterAll(async () => {
    await mocks.db?.$client.end();
  });
  it("serves image bytes only within the owning workspace or portal deal", async () => {
    const db = mocks.db;
    assert(db);
    const ids = await makeDeal(db);
    const [e] = await db
      .insert(schema.evidence)
      .values({
        milestoneId: ids.milestoneId,
        kind: "screenshot",
        summary: "Screenshot",
        data: {},
        contentHash: "image",
      })
      .returning();
    assert(e);
    await db.insert(schema.evidenceImage).values({ evidenceId: e.id, base64: "/9j/AAAA" });
    const response = await evidenceImageResponse(e.id, { workspaceId: ids.workspaceId });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await evidenceImageResponse(e.id, { workspaceId: crypto.randomUUID() })).status).toBe(
      404,
    );
    expect(
      (await evidenceImageResponse(e.id, { clientId: crypto.randomUUID() }, ids.dealId)).status,
    ).toBe(404);
  });
});
