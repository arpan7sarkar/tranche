export type Email = { to: string; subject: string; body: string; key: string };
export type SendEmail = (email: Email) => Promise<string>;

export function emailSender(env: NodeJS.ProcessEnv = process.env): SendEmail | null {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) return null;
  return async (email) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.key,
      },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.body }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("email_provider_unconfirmed");
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("id" in result) ||
      typeof result.id !== "string" ||
      !result.id
    )
      throw new Error("email_provider_unconfirmed");
    return result.id;
  };
}
