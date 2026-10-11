import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, hashToken, migrateDb, schema } from "./index";
import { createMagicLink, resolveMagicLink } from "./magic-links";
import { seed } from "./seed";

const url = process.env.DATABASE_URL;
const db = url ? createDb(url) : null;

describe.runIf(Boolean(db))("magic links", () => {
  let ids: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => {
    await migrateDb(db!);
    ids = await seed(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("resolves a fresh link", async () => {
    const { token, url: link } = await createMagicLink(db!, {
      clientId: ids.clientId,
      dealId: ids.dealId,
    });
    expect(link.endsWith(`/portal/${token}`)).toBe(true);
    expect(await resolveMagicLink(db!, token)).toEqual({
      clientId: ids.clientId,
      dealId: ids.dealId,
    });
  });

  it("rejects a tampered token", async () => {
    const { token } = await createMagicLink(db!, { clientId: ids.clientId, dealId: ids.dealId });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(await resolveMagicLink(db!, tampered)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const past = new Date(Date.now() - 40 * 86_400_000);
    const { token } = await createMagicLink(db!, {
      clientId: ids.clientId,
      dealId: ids.dealId,
      now: past,
    });
    expect(await resolveMagicLink(db!, token)).toBeNull();
  });

  it("rejects malformed tokens without querying", async () => {
    expect(await resolveMagicLink(db!, "short")).toBeNull();
    expect(await resolveMagicLink(db!, "%".repeat(43))).toBeNull();
  });

  it("rejects a well-formed token that was never issued", async () => {
    const unknown = randomBytes(32).toString("base64url");
    expect(await resolveMagicLink(db!, unknown)).toBeNull();
  });

  it("stores the hash of the token, never the raw token", async () => {
    const { token } = await createMagicLink(db!, { clientId: ids.clientId, dealId: ids.dealId });
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    const rows = await db!
      .select()
      .from(schema.magicLink)
      .where(eq(schema.magicLink.tokenHash, hash));
    expect(rows).toHaveLength(1);
    const raw = await db!
      .select()
      .from(schema.magicLink)
      .where(eq(schema.magicLink.tokenHash, token));
    expect(raw).toHaveLength(0);
  });
});
