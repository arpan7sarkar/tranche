import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const FORWARDED = "x-middleware-request-x-tranche-path";

function request(path: string, init: { signedIn: boolean; headers?: Record<string, string> }) {
  const headers = new Headers(init.headers);
  if (init.signedIn) headers.set("cookie", "better-auth.session_token=abc.def");
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

describe("proxy", () => {
  it("forwards the request path and search as x-tranche-path", () => {
    const res = proxy(request("/deals/abc?x=1&y=2", { signedIn: true }));
    expect(res.headers.get(FORWARDED)).toBe("/deals/abc?x=1&y=2");
    expect(res.headers.get("x-middleware-override-headers")).toContain("x-tranche-path");
  });

  it("forwards a path without a search as the bare path", () => {
    const res = proxy(request("/approvals", { signedIn: true }));
    expect(res.headers.get(FORWARDED)).toBe("/approvals");
  });

  it("overwrites an x-tranche-path header the client sent", () => {
    const res = proxy(
      request("/deals", { signedIn: true, headers: { "x-tranche-path": "//evil.com" } }),
    );
    expect(res.headers.get(FORWARDED)).toBe("/deals");
  });

  it("still redirects to sign-in with the encoded next path when there is no session cookie", () => {
    const res = proxy(request("/deals?x=1", { signedIn: false }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `http://localhost:3000/sign-in?next=${encodeURIComponent("/deals?x=1")}`,
    );
  });
});
