import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  decryptGmailToken,
  encryptGmailToken,
  gmailConfig,
  gmailMessage,
  googleTokens,
  googleUser,
} from "./gmail";

afterEach(() => vi.unstubAllGlobals());
const env = {
  GMAIL_CLIENT_ID: "test-client",
  GMAIL_CLIENT_SECRET: "test-secret",
  GMAIL_REDIRECT_URI: "http://localhost:3000/api/gmail/callback",
  GMAIL_TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
};
it("encrypts refresh tokens and binds them to a workspace", () => {
  const key = randomBytes(32);
  const encrypted = encryptGmailToken("private-refresh", "workspace-a", key);
  expect(encrypted).not.toContain("private-refresh");
  expect(decryptGmailToken(encrypted, "workspace-a", key)).toBe("private-refresh");
  expect(() => decryptGmailToken(encrypted, "workspace-b", key)).toThrow();
  expect(() => decryptGmailToken(encrypted, "workspace-a", randomBytes(32))).toThrow();
  const parts = encrypted.split(".");
  parts[2] = Buffer.from("tampered").toString("base64url");
  expect(() => decryptGmailToken(parts.join("."), "workspace-a", key)).toThrow();
});
it("rejects incomplete configuration and insecure remote callbacks", () => {
  expect(gmailConfig({})).toBeNull();
  expect(gmailConfig(env)?.clientId).toBe("test-client");
  expect(gmailConfig({ ...env, GMAIL_REDIRECT_URI: "http://remote.example/callback" })).toBeNull();
});
it("uses the authenticated address and encodes untrusted names, subjects and Unicode body safely", () => {
  const raw = gmailMessage(
    {
      to: "client@example.com",
      subject: "Plan\r\nBcc: other@example.com",
      body: "Hello 🌍",
      key: "job-1",
    },
    "sender@gmail.com",
    "Sender\r\nBcc: bad@example.com",
  );
  const message = Buffer.from(raw, "base64url").toString();
  expect(message).toContain("<sender@gmail.com>");
  expect(message).toContain("To: client@example.com\r\n");
  expect(message).not.toContain("\r\nBcc:");
  expect(Buffer.from(message.split("\r\n\r\n")[1] ?? "", "base64").toString()).toBe("Hello 🌍");
  expect(() =>
    gmailMessage(
      { to: "client@example.com\r\nBcc: bad@example.com", subject: "Plan", body: "x", key: "x" },
      "sender@gmail.com",
      "Sender",
    ),
  ).toThrow();
});
it("keeps provider error bodies and tokens out of thrown errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("private-provider-details", { status: 400 })),
  );
  await expect(
    googleTokens({ grant_type: "refresh_token", refresh_token: "private-refresh" }, env),
  ).rejects.toThrow("gmail_authorization_failed");
});
it("requires a verified Google email identity", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ sub: "google-user", email: "sender@gmail.com", email_verified: false }),
    ),
  );
  await expect(googleUser("private-token")).rejects.toThrow();
});
