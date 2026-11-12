import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  encryptGmailToken,
  GMAIL_SEND_SCOPE,
  gmailConfig,
  googleTokens,
  googleUser,
} from "@tranche/agents-service/gmail";
import { schema } from "@tranche/db";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "./db";
import { getMember, type Member } from "./session";

export const GMAIL_STATE_COOKIE = "tranche_gmail_state";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function gmailOwner(): Promise<Member | null> {
  const member = await getMember();
  if (!member) return null;
  const [owner] = await getDb()
    .select({ userId: schema.workspaceMember.userId })
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, member.workspaceId),
        eq(schema.workspaceMember.userId, member.userId),
        eq(schema.workspaceMember.role, "owner"),
      ),
    );
  return owner ? member : null;
}

export function gmailSameOrigin(request: Request) {
  const config = gmailConfig();
  return Boolean(config && request.headers.get("origin") === new URL(config.redirectUri).origin);
}

export async function beginGmail(member: Member) {
  const config = gmailConfig();
  if (!config) throw new Error("gmail_not_configured");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  await getDb()
    .insert(schema.verification)
    .values({
      id: crypto.randomUUID(),
      identifier: `gmail:${hash(state)}`,
      value: JSON.stringify({ userId: member.userId, workspaceId: member.workspaceId, verifier }),
      expiresAt: new Date(Date.now() + 10 * 60000),
    });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: `openid email ${GMAIL_SEND_SCOPE}`,
    access_type: "offline",
    prompt: "consent select_account",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { state, url: url.toString() };
}

export async function consumeGmailState(member: Member, state: string, cookie: string) {
  if (
    !/^[\w-]{43}$/.test(state) ||
    state.length !== cookie.length ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))
  )
    throw new Error("gmail_invalid_state");
  const [attempt] = await getDb()
    .delete(schema.verification)
    .where(
      and(
        eq(schema.verification.identifier, `gmail:${hash(state)}`),
        gt(schema.verification.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!attempt) throw new Error("gmail_invalid_state");
  const saved = JSON.parse(attempt.value) as {
    userId: string;
    workspaceId: string;
    verifier: string;
  };
  if (saved.userId !== member.userId || saved.workspaceId !== member.workspaceId)
    throw new Error("gmail_invalid_state");
  return saved.verifier;
}

export async function finishGmail(member: Member, code: string, verifier: string) {
  const config = gmailConfig();
  if (!config) throw new Error("gmail_not_configured");
  const token = await googleTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });
  if (!token.refresh_token || !token.scope?.split(" ").includes(GMAIL_SEND_SCOPE))
    throw new Error("gmail_permission_missing");
  const identity = await googleUser(token.access_token);
  const values = {
    id: crypto.randomUUID(),
    workspaceId: member.workspaceId,
    connectedBy: member.userId,
    email: identity.email,
    name: member.name,
    googleSubject: identity.sub,
    refreshTokenCiphertext: encryptGmailToken(token.refresh_token, member.workspaceId, config.key),
    connectedAt: new Date(),
  };
  await getDb()
    .insert(schema.gmailConnection)
    .values(values)
    .onConflictDoUpdate({ target: schema.gmailConnection.workspaceId, set: values });
}
