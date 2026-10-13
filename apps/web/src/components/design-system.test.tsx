import { MilestoneState } from "@tranche/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { MilestoneBadge } from "@/components/milestone-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { milestoneTone } from "@/lib/milestone-tone";

const nav = vi.hoisted(() => ({ pathname: "/deals" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const html = (node: ReactNode) => renderToStaticMarkup(node);
const text = (fragment: string) => fragment.replace(/<[^>]*>/g, "");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const hasClass = (markup: string, cls: string) =>
  new RegExp(`class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"`).test(markup);

describe("EmptyState", () => {
  it("renders title, body and action", () => {
    const out = html(
      <EmptyState
        title="No deals yet"
        body="Create your first deal."
        action={<a href="/new">Start</a>}
      />,
    );
    expect(out).toContain("No deals yet");
    expect(out).toContain("Create your first deal.");
    expect(out).toContain('<a href="/new">Start</a>');
  });

  it("renders without an action", () => {
    const out = html(<EmptyState title="Nothing" body="Empty." />);
    expect(out).toContain("Nothing");
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("<button");
  });

  it("escapes untrusted title and body text", () => {
    const out = html(<EmptyState title="<script>x</script>" body={'<img src=x onerror="y">'} />);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});

describe("LoadingState", () => {
  it("renders four skeletons by default", () => {
    expect(count(html(<LoadingState />), 'data-slot="skeleton"')).toBe(4);
  });

  it("is a status region", () => {
    expect(html(<LoadingState />)).toContain('role="status"');
  });

  it("is not aria-busy, which suppresses the announcement", () => {
    expect(html(<LoadingState />)).not.toContain("aria-busy");
  });

  it("contains visually hidden Loading text", () => {
    expect(html(<LoadingState />)).toMatch(
      /<[a-z]+\b[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*>Loading<\/[a-z]+>/,
    );
  });

  it("renders the requested number of skeletons", () => {
    expect(count(html(<LoadingState rows={7} />), 'data-slot="skeleton"')).toBe(7);
    expect(count(html(<LoadingState rows={1} />), 'data-slot="skeleton"')).toBe(1);
  });
});

describe("ErrorState", () => {
  it("is an alert with title and body", () => {
    const out = html(<ErrorState title="Could not load" body="Try later." />);
    expect(out).toContain('role="alert"');
    expect(out).toContain("Could not load");
    expect(out).toContain("Try later.");
  });

  it("shows Try again only when retry is passed", () => {
    expect(html(<ErrorState title="t" body="b" />)).not.toContain("Try again");
    expect(html(<ErrorState title="t" body="b" />)).not.toContain("<button");
    const out = html(<ErrorState title="t" body="b" retry={() => {}} />);
    expect(out).toMatch(/<button[^>]*>[\s\S]*Try again[\s\S]*<\/button>/);
  });

  it("escapes untrusted text", () => {
    const out = html(<ErrorState title="<script>x</script>" body="<b>y</b>" />);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<b>y</b>");
  });
});

describe("MilestoneBadge", () => {
  for (const state of MilestoneState.options) {
    it(`renders ${state} with its label and tone class`, () => {
      const { label, tone } = milestoneTone(state);
      const out = html(<MilestoneBadge state={state} />);
      expect(text(out)).toContain(label);
      expect(hasClass(out, `text-tone-${tone}`), `text-tone-${tone} in ${out}`).toBe(true);
    });
  }
});

describe("AppShell", () => {
  const user = { name: "Ada Lovelace", workspaceName: "Analytical Engines" };
  const out = html(
    <AppShell user={user}>
      <p data-testid="page">Page body</p>
    </AppShell>,
  );

  it("has a Main navigation with the four destinations", () => {
    const nav = out.match(/<nav\b[^>]*\baria-label="Main"[^>]*>([\s\S]*?)<\/nav>/);
    expect(nav, "nav with aria-label Main").not.toBeNull();
    const links = [
      ...(nav?.[1] ?? "").matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g),
    ].map((m) => [m[1], text(m[2] ?? "").trim()]);
    for (const pair of [
      ["/deals", "Deals"],
      ["/approvals", "Approvals"],
      ["/dashboard", "Cash flow"],
      ["/onboarding", "Connections"],
    ]) {
      expect(links).toContainEqual(pair);
    }
  });

  describe("current page", () => {
    const current = (pathname: string) => {
      nav.pathname = pathname;
      const markup = html(<AppShell user={user}>x</AppShell>);
      const inner =
        markup.match(/<nav\b[^>]*\baria-label="Main"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
      return [...inner.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
        label: text(m[2] ?? "").trim(),
        current: m[1]?.match(/\baria-current="([^"]*)"/)?.[1] ?? null,
      }));
    };
    const marked = (pathname: string) =>
      current(pathname)
        .filter((l) => l.current !== null)
        .map((l) => `${l.label}=${l.current}`);

    beforeEach(() => {
      nav.pathname = "/deals";
    });

    it("marks the link whose href equals the pathname", () => {
      expect(marked("/deals")).toEqual(["Deals=page"]);
      expect(marked("/approvals")).toEqual(["Approvals=page"]);
      expect(marked("/dashboard")).toEqual(["Cash flow=page"]);
      expect(marked("/onboarding")).toEqual(["Connections=page"]);
    });

    it("marks the parent link on nested pages", () => {
      expect(marked("/deals/abc")).toEqual(["Deals=page"]);
      expect(marked("/deals/abc/negotiation")).toEqual(["Deals=page"]);
      expect(marked("/onboarding/github")).toEqual(["Connections=page"]);
    });

    it("marks nothing on unrelated paths and on look-alike prefixes", () => {
      expect(marked("/")).toEqual([]);
      expect(marked("/settings")).toEqual([]);
      expect(marked("/dealership")).toEqual([]);
    });

    it("keeps all four links rendered", () => {
      expect(current("/deals/abc").map((l) => l.label)).toEqual(
        expect.arrayContaining(["Deals", "Approvals", "Cash flow", "Connections"]),
      );
    });
  });

  it("shows the workspace and user names", () => {
    expect(text(out)).toContain("Analytical Engines");
    expect(text(out)).toContain("Ada Lovelace");
  });

  it("renders children inside main", () => {
    const main = out.match(/<main\b[^>]*>([\s\S]*)<\/main>/);
    expect(main?.[1]).toContain('<p data-testid="page">Page body</p>');
  });

  it("escapes untrusted user names", () => {
    const evil = html(
      <AppShell user={{ name: "<script>x</script>", workspaceName: "<b>w</b>" }}>x</AppShell>,
    );
    expect(evil).not.toContain("<script>");
    expect(evil).not.toContain("<b>w</b>");
  });
});
