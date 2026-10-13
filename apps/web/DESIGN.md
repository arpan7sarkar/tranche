# Tranche Design System

Visual direction: "Ledger".
Warm paper neutrals, ink-blue text, and color only where money or state changes.

## Tokens

All colors live in `src/app/globals.css` and switch with the system color scheme.
Use Tailwind token classes such as `bg-background`, `text-muted-foreground`, `border-border`.
Never use raw hex values or palette classes such as `bg-zinc-50`.
State colors: `tone-neutral`, `tone-progress`, `tone-held`, `tone-verifying`, `tone-attention`, `tone-released`, `tone-danger`.
Held money is amber, money that moved is settlement green, verification is indigo.
Every tone text color keeps at least 4.5:1 contrast on its badge tint over the background, card, popover, sidebar and table row hover surfaces, in light and dark.
The destructive button and badge tints meet the same bar.
Both are enforced by `src/app/tokens.test.ts`.
When changing a tone, adjust lightness only and re-run that suite.

## Type

Page titles use `font-serif` (Instrument Serif), set automatically on `h1` and `h2`.
UI text uses Instrument Sans.
Every amount, date and id uses the `tabular` utility (IBM Plex Mono, tabular figures).

## Money

Always render money with `formatMoney(m)` from `@/lib/money`.
Never divide minor units in a component.

## Milestone state

Use `<MilestoneBadge state={...} />`; labels and tones come from `milestoneTone` in `@/lib/milestone-tone`.

## States

Every screen renders `LoadingState`, `EmptyState` and `ErrorState` from `@/components/states` for its loading, empty and failure cases.
Route segments use `loading.tsx` with `LoadingState` and `error.tsx` with `ErrorState`.
`ErrorState` takes a `retry` callback, so use it from a client component such as `error.tsx`.

## Shell

`AppShell` wraps every agency page.
It is a sidebar from the `md` breakpoint and a scrolling top navigation below it.
The current page link carries `aria-current="page"` and an active style, set by the client `MainNav`.
Nav links use an inset focus ring so the scroll container never clips it.

## Components

shadcn components live in `@/components/ui`.
Add new ones with `pnpm dlx shadcn@4.21.4 add <name> -c apps/web`.
Do not hand-edit generated files; the Biome override for that folder lives in the root `biome.json`.

## Untrusted text

Agent and client text (task names, reasoning, evidence summaries) is rendered as plain text, never with `dangerouslySetInnerHTML`.
