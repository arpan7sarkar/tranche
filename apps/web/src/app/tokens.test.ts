import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

const TONES = [
  "neutral",
  "progress",
  "held",
  "verifying",
  "attention",
  "released",
  "danger",
] as const;
const BADGE_ALPHA: Record<(typeof TONES)[number], number> = {
  neutral: 0.12,
  progress: 0.12,
  held: 0.15,
  verifying: 0.12,
  attention: 0.15,
  released: 0.15,
  danger: 0.12,
};
const CORE = [
  "background",
  "foreground",
  "card",
  "primary",
  "muted",
  "muted-foreground",
  "border",
  "destructive",
  "ring",
];

type Block = { header: string; body: string };
type Scheme = "light" | "dark";
type Rgb = [number, number, number];

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let depth = 0;
  let headerStart = 0;
  let bodyStart = 0;
  let header = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      if (depth === 0) {
        header = src.slice(headerStart, i).trim();
        bodyStart = i + 1;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        blocks.push({ header, body: src.slice(bodyStart, i) });
        headerStart = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      headerStart = i + 1;
    }
  }
  return blocks;
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+?)\s*(?:;|$)/g)) {
    if (m[1] && m[2]) out.set(m[1], m[2]);
  }
  return out;
}

const topLevel = parseBlocks(css);
const light = new Map<string, string>();
for (const b of topLevel.filter((x) => x.header === ":root")) {
  for (const [k, v] of declarations(b.body)) light.set(k, v);
}
const dark = new Map<string, string>();
for (const b of topLevel.filter((x) =>
  /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/.test(x.header),
)) {
  for (const inner of parseBlocks(b.body).filter((x) => x.header === ":root")) {
    for (const [k, v] of declarations(inner.body)) dark.set(k, v);
  }
}
const theme = new Map<string, string>();
for (const b of topLevel.filter((x) => /^@theme\s+inline$/.test(x.header))) {
  for (const [k, v] of declarations(b.body)) theme.set(k, v);
}
const effective: Record<Scheme, Map<string, string>> = {
  light,
  dark: new Map([...light, ...dark]),
};

function resolve(name: string, scheme: Scheme): string {
  const value = effective[scheme].get(name);
  if (value === undefined) throw new Error(`${name} is not defined for the ${scheme} scheme`);
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (_, ref: string) =>
    resolve(ref, scheme),
  );
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function oklchToSrgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin: Rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return [encode(clamp01(lin[0])), encode(clamp01(lin[1])), encode(clamp01(lin[2]))];
}

function parseColor(value: string): Rgb {
  const ok = value.match(
    /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)(%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.]+%?)?\s*\)$/,
  );
  if (ok) {
    const l = Number(ok[1]) / (ok[2] ? 100 : 1);
    const c = ok[4] ? (Number(ok[3]) * 0.4) / 100 : Number(ok[3]);
    return oklchToSrgb(l, c, Number(ok[5]));
  }
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex?.[1]) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join("") : hex[1];
    return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
  }
  throw new Error(`unsupported color value: ${value}`);
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => alpha * (fg[i] as number) + (1 - alpha) * (bg[i] as number)) as Rgb;
}

const color = (name: string, scheme: Scheme) => parseColor(resolve(name, scheme));

describe("contrast helper", () => {
  it("measures black on white as 21:1 and an achromatic grey by its cubed lightness", () => {
    expect(contrast(parseColor("oklch(1 0 0)"), parseColor("oklch(0 0 0)"))).toBeCloseTo(21, 1);
    const grey = contrast(parseColor("oklch(0.6 0 0)"), parseColor("oklch(1 0 0)"));
    expect(grey).toBeCloseTo(1.05 / (0.6 ** 3 + 0.05), 2);
  });
});

describe("design tokens", () => {
  it("defines the tone and core shadcn tokens in :root", () => {
    for (const t of TONES) expect(light.has(`--tone-${t}`), `--tone-${t}`).toBe(true);
    for (const t of CORE) expect(light.has(`--${t}`), `--${t}`).toBe(true);
  });

  it("redefines the background tokens for dark mode", () => {
    for (const t of ["background", "foreground", "card", "muted-foreground", "border"]) {
      expect(dark.has(`--${t}`), `--${t}`).toBe(true);
    }
  });

  it("resolves every tone to a different color in dark mode", () => {
    for (const t of TONES) {
      expect(resolve(`--tone-${t}`, "dark"), `--tone-${t}`).not.toBe(
        resolve(`--tone-${t}`, "light"),
      );
    }
  });

  it("maps every tone into the Tailwind theme", () => {
    for (const t of TONES) expect(theme.has(`--color-tone-${t}`), `--color-tone-${t}`).toBe(true);
  });

  it("declares the dark variant and the tabular utility", () => {
    expect(css).toMatch(/@custom-variant\s+dark\b/);
    expect(css).toMatch(/@utility\s+tabular\b/);
  });
});

const ui = (file: string) =>
  readFileSync(new URL(`../components/ui/${file}`, import.meta.url), "utf8");

function surfaces(scheme: Scheme): [string, Rgb][] {
  const hover = ui("table.tsx").match(/\bhover:bg-([a-z-]+)(?:\/(\d+))?/);
  if (!hover?.[1]) throw new Error("table.tsx has no hover:bg-* row class");
  const background = color("--background", scheme);
  const row = over(color(`--${hover[1]}`, scheme), Number(hover[2] ?? 100) / 100, background);
  return [
    ["background", background],
    ["card", color("--card", scheme)],
    ["popover", color("--popover", scheme)],
    ["sidebar", color("--sidebar", scheme)],
    [`table row hover (${hover[0]})`, row],
  ];
}

function destructiveVariant(file: string, scheme: Scheme) {
  const variant = ui(file).match(/\bdestructive:\s*"([^"]*)"/);
  if (!variant?.[1]) throw new Error(`${file} has no destructive variant`);
  const pick = (re: RegExp) => {
    const tokens = variant[1]?.split(/\s+/) ?? [];
    const scoped = scheme === "dark" ? tokens.filter((t) => t.startsWith("dark:")) : [];
    const base = tokens.filter((t) => !t.includes(":"));
    for (const t of [...scoped, ...base]) {
      const m = t.replace(/^dark:/, "").match(re);
      if (m?.[1]) return m;
    }
    return null;
  };
  const bg = pick(/^bg-([a-z-]+)(?:\/(\d+))?$/);
  const fg = pick(/^text-([a-z-]+)$/);
  if (!bg?.[1] || !fg?.[1])
    throw new Error(`${file} destructive variant lacks a tint and text color`);
  return { text: `--${fg[1]}`, tint: `--${bg[1]}`, alpha: Number(bg[2] ?? 100) / 100 };
}

describe("token contrast", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const tone of TONES) {
      for (const surface of ["background", "card", "popover", "sidebar", "table row hover"]) {
        it(`${tone} badge on ${surface} is at least 4.5:1 in ${scheme}`, () => {
          const fg = color(`--tone-${tone}`, scheme);
          const base = surfaces(scheme).find(([name]) => name.startsWith(surface))?.[1];
          if (!base) throw new Error(`no ${surface} surface`);
          expect(contrast(fg, over(fg, BADGE_ALPHA[tone], base))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    for (const file of ["button.tsx", "badge.tsx"]) {
      for (const surface of ["background", "card"]) {
        it(`destructive ${file.replace(".tsx", "")} on ${surface} is at least 4.5:1 in ${scheme}`, () => {
          const v = destructiveVariant(file, scheme);
          const fg = color(v.text, scheme);
          const base = surfaces(scheme).find(([name]) => name === surface)?.[1];
          if (!base) throw new Error(`no ${surface} surface`);
          const tint = over(color(v.tint, scheme), v.alpha, base);
          expect(contrast(fg, tint)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    it(`muted-foreground on background is at least 4.5:1 in ${scheme}`, () => {
      const ratio = contrast(color("--muted-foreground", scheme), color("--background", scheme));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("component color discipline", () => {
  const files = (readdirSync(SRC, { recursive: true }) as string[])
    .map((f) => f.replaceAll("\\", "/"))
    .filter(
      (f) =>
        f.endsWith(".tsx") &&
        !f.endsWith(".test.tsx") &&
        (f.startsWith("components/") || f.startsWith("app/")) &&
        !f.startsWith("components/ui/"),
    );

  const PALETTE =
    "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|mauve|olive|mist|taupe";
  const UTILITY =
    "bg|text|border|border-[xytblrse]|ring|ring-offset|outline|fill|stroke|from|via|to|divide|decoration|accent|caret|shadow|placeholder";
  const paletteClass = new RegExp(
    `(?<![\\w-])-?(?:${UTILITY})-(?:${PALETTE})-(?:50|[1-9]00|950)(?:/\\d+)?(?![\\w-])`,
  );
  const hexColor =
    /(?<![\w&])#(?:[\da-f]{8}|[\da-f]{6})(?![\w-])|(?<=["'`[(:])#[\da-f]{3,4}(?![\w-])/i;

  it("finds component and app files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("uses no raw hex colors", () => {
    const offenders = files.filter((f) => hexColor.test(readFileSync(`${SRC}/${f}`, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("uses no Tailwind palette classes", () => {
    const offenders = files.filter((f) => paletteClass.test(readFileSync(`${SRC}/${f}`, "utf8")));
    expect(offenders).toEqual([]);
  });
});
