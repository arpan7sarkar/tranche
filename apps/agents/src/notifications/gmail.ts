import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { type Db, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Email, SendEmail } from "./email";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export function gmailConfig(env: NodeJS.ProcessEnv = process.env) {
  const {
    GMAIL_CLIENT_ID: clientId,
    GMAIL_CLIENT_SECRET: clientSecret,
    GMAIL_REDIRECT_URI: redirectUri,
    GMAIL_TOKEN_ENCRYPTION_KEY: key,
  } = env;
  if (!clientId || !clientSecret || !redirectUri || !key || !/^[a-f\d]{64}$/i.test(key))
    return null;
  if (!URL.canParse(redirectUri)) return null;
  const url = new URL(redirectUri);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    return null;
  return { clientId, clientSecret, redirectUri, key: Buffer.from(key, "hex") };
}

export function encryptGmailToken(token: string, workspaceId: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(workspaceId));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}
export function decryptGmailToken(value: string, workspaceId: string, key: Buffer) {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("gmail_token_invalid");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(workspaceId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

const Token = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});
export async function googleTokens(
  params: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = gmailConfig(env);
  if (!config) throw new Error("gmail_not_configured");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...params,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("gmail_authorization_failed");
  return Token.parse(await response.json());
}

export const GoogleUser = z.object({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.literal(true),
});
export async function googleUser(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("gmail_identity_failed");
  return GoogleUser.parse(await response.json());
}

export type EmailTransport = { transport: "gmail" | "resend"; identity: string; send: SendEmail };
type Store = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
export type ResolveEmailTransport = (
  job: typeof schema.notificationJob.$inferSelect,
  store?: Store,
) => Promise<EmailTransport | null>;

export function gmailMessage(email: Email, from: string, name: string) {
  if (
    !z.email().safeParse(from).success ||
    !z.email().safeParse(email.to).success ||
    /[\r\n]/.test(from + email.to)
  )
    throw new Error("invalid_email_address");
  const encoded = (text: string) =>
    `=?UTF-8?B?${Buffer.from(text.replace(/[\r\n]/g, " ")).toString("base64")}?=`;
  const body =
    Buffer.from(email.body)
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? "";
  return Buffer.from(
    [
      `From: ${encoded(`${name} via Tranche`)} <${from}>`,
      `To: ${email.to}`,
      `Subject: ${encoded(email.subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      body,
    ].join("\r\n"),
  ).toString("base64url");
}

export function resolveEmailTransport(
  db: Db,
  fallback: SendEmail | null,
  env: NodeJS.ProcessEnv = process.env,
): ResolveEmailTransport {
  return async (job, store = db) => {
    if (job.side === "client" && job.transport !== "resend") {
      const [connection] = await store
        .select({ gmail: schema.gmailConnection })
        .from(schema.gmailConnection)
        .innerJoin(schema.deal, eq(schema.deal.workspaceId, schema.gmailConnection.workspaceId))
        .where(eq(schema.deal.id, job.dealId));
      if (connection) {
        const config = gmailConfig(env);
        if (!config) return null;
        const gmail = connection.gmail;
        return {
          transport: "gmail",
          identity: gmail.id,
          send: async (email) => {
            const [current] = await db
              .select({ id: schema.gmailConnection.id })
              .from(schema.gmailConnection)
              .where(eq(schema.gmailConnection.id, gmail.id));
            if (!current) throw new Error("gmail_disconnected");
            const refreshToken = decryptGmailToken(
              gmail.refreshTokenCiphertext,
              gmail.workspaceId,
              config.key,
            );
            const token = await googleTokens(
              { grant_type: "refresh_token", refresh_token: refreshToken },
              env,
            );
            const response = await fetch(
              "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token.access_token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ raw: gmailMessage(email, gmail.email, gmail.name) }),
                signal: AbortSignal.timeout(15000),
              },
            );
            if (!response.ok) throw new Error("gmail_send_unconfirmed");
            return z.object({ id: z.string().min(1) }).parse(await response.json()).id;
          },
        };
      }
      if (job.transport === "gmail") return null;
    }
    return fallback
      ? { transport: "resend", identity: env.EMAIL_FROM ?? "", send: fallback }
      : null;
  };
}
