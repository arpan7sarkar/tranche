import { MilestoneState } from "@tranche/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/app-shell";
import { MilestoneBadge } from "@/components/milestone-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { milestoneTone } from "@/lib/milestone-tone";

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
  it("renders four skeletons by default and is aria-busy", () => {
    const out = html(<LoadingState />);
    expect(count(out, 'data-slot="skeleton"')).toBe(4);
    expect(out).toContain('aria-busy="true"');
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
