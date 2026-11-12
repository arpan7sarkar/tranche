import { NextResponse } from "next/server";
import { beginGmail, GMAIL_STATE_COOKIE, gmailOwner, gmailSameOrigin } from "@/server/gmail";

export async function POST(request: Request) {
  const owner = await gmailOwner();
  if (!owner) return Response.json({ error: "Workspace owner access required." }, { status: 403 });
  if (!gmailSameOrigin(request))
    return Response.json(
      { error: "Gmail is not configured or the request origin is invalid." },
      { status: 400 },
    );
  const { url, state } = await beginGmail(owner);
  const response = NextResponse.json({ url });
  response.cookies.set(GMAIL_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.GMAIL_REDIRECT_URI?.startsWith("https:") ?? false,
    sameSite: "lax",
    path: "/api/gmail",
    maxAge: 600,
  });
  return response;
}
