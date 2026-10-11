import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "./index";
import { magicLink } from "./schema";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 86_400_000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createMagicLink(
  db: Db | Tx,
  input: { clientId: string; dealId: string; ttlDays?: number; now?: Date },
): Promise<{ token: string; url: string }> {
  const token = randomBytes(32).toString("base64url");
  const now = input.now ?? new Date();
  await db.insert(magicLink).values({
    clientId: input.clientId,
    dealId: input.dealId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + (input.ttlDays ?? 30) * DAY_MS),
  });
  return { token, url: `${process.env.APP_URL ?? "http://localhost:3000"}/portal/${token}` };
}

export async function resolveMagicLink(
  db: Db,
  token: string,
  now = new Date(),
): Promise<{ clientId: string; dealId: string } | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db
    .select()
    .from(magicLink)
    .where(eq(magicLink.tokenHash, hashToken(token)));
  if (!row || row.expiresAt <= now) return null;
  return { clientId: row.clientId, dealId: row.dealId };
}
