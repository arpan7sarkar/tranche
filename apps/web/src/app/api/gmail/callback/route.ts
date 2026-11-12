import { gmailConfig } from "@tranche/agents-service/gmail";
import { type NextRequest, NextResponse } from "next/server";
import { consumeGmailState, finishGmail, GMAIL_STATE_COOKIE, gmailOwner } from "@/server/gmail";

export async function GET(request: NextRequest) {
  const owner = await gmailOwner();
  let result = "failed";
  try {
    if (!owner) throw new Error("gmail_owner_required");
    const verifier = await consumeGmailState(
      owner,
      request.nextUrl.searchParams.get("state") ?? "",
      request.cookies.get(GMAIL_STATE_COOKIE)?.value ?? "",
    );
    if (request.nextUrl.searchParams.has("error")) result = "denied";
    else {
      const code = request.nextUrl.searchParams.get("code");
      if (!code || code.length > 8192) throw new Error("gmail_invalid_code");
      await finishGmail(owner, code, verifier);
      result = "connected";
    }
  } catch {
    /* Credentials and Google responses must stay out of logs. */
  }
  const response = NextResponse.redirect(
    new URL(`/onboarding?gmail=${result}`, gmailConfig()?.redirectUri ?? request.url),
  );
  response.cookies.set(GMAIL_STATE_COOKIE, "", { path: "/api/gmail", maxAge: 0 });
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  return response;
}
