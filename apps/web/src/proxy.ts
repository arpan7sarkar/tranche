import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { PATH_HEADER } from "@/lib/request-path";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const path = `${pathname}${search}`;
  if (getSessionCookie(request)) {
    const headers = new Headers(request.headers);
    headers.set(PATH_HEADER, path);
    return NextResponse.next({ request: { headers } });
  }
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("next", path);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/deals/:path*", "/approvals/:path*", "/onboarding/:path*", "/dashboard/:path*"],
};
