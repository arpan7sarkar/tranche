# Landing page visual QA

Source visual truth: `/home/subhamoy/.codex/generated_images/01a1cf5d-9d1a-7270-b5ce-2dbb7b08c511/exec-af7f25a7-65c5-40b3-8bd6-a3625d2b34d0.png`.
Implementation: public homepage at `http://localhost:3000/`.
The generated hero is the reference for the opening section; the remaining sections extend the existing product design system.

## Evidence

- Full hero comparison: `tmp/landing/hero-comparison.png`.
- Focused typography comparison: `tmp/landing/hero-type-comparison.png`.
- Desktop hero: `tmp/landing/desktop-dark-hero.png` and `tmp/landing/desktop-light-hero.png`.
- Desktop full page: `tmp/landing/desktop-dark-full.png` and `tmp/landing/desktop-light-full.png`.
- Mobile hero: `tmp/landing/mobile-dark-hero.png` and `tmp/landing/mobile-light-hero.png`.
- Mobile full page: `tmp/landing/mobile-dark-full.png` and `tmp/landing/mobile-light-full.png`.
- Technology logo checks: `tmp/landing/desktop-dark-technology.png` and `tmp/landing/mobile-light-technology.png`.
- Browser interaction results: `tmp/landing/verification.json`.
- Production build: `tmp/landing/build.log`.
- Focused tests and lint: `tmp/landing/tests.log` and `tmp/landing/biome.log`.

The source and desktop hero captures are both 1536 × 1024 pixels at a 1536 × 1024 CSS viewport with device scale factor 1.
The full comparison places them side by side without scaling.
The focused comparison uses equally sized native-resolution crops.
Mobile captures use 390 × 844 CSS pixels at device scale factor 1.
Hero captures show the initial public, signed-out state.
Full-page captures include an expanded FAQ after interaction checks and loaded lazy images.

## Required fidelity surfaces

- Typography: Georgia serif headings and Arial body copy match the existing application and the reference direction; the desktop headline retains its three-line composition.
- Layout: the desktop header, split hero, project panel, CTA group, and lower rule follow the source composition; mobile stacks the panel below the copy with balanced headline wrapping.
- Colors: existing light/dark tokens control the page; mint approval states and purple schedule bars preserve the reference hierarchy.
- Assets: product screenshots and the existing approved walkthrough are real application captures; technology logos use the previously obtained brand assets, and the app mark uses the Lucide Layers2 icon consistently across navigation and favicon formats.
- Content: the sample is labelled as a demo; the USD 1.00 paid milestone and USD 4,799 unfunded implementation milestone reflect the demonstrated project, and timeline labels use its actual dates.

The added navigation links, layered app mark, accurate dates, and explicit unfunded disclaimer are intentional extensions to the source.
Body copy and action text follow the application's smaller type scale rather than matching every generated-image glyph measurement.

## Comparison history

1. The first browser pass found awkward mobile heading wrapping and small project-panel labels.
   Balanced headline wrapping and larger panel typography resolved those issues; the final hero screenshots show the updated layout.
2. Token tests identified literal component colors, and lint identified SVG accessibility attributes.
   The mark now uses CSS brand tokens, viewport metadata uses valid RGB colors, and SVG titles and attributes pass the repository checks.
3. Initial full-page screenshots captured logos before lazy image loading.
   The final production pass scrolled the technology section into view and waited for every logo to load before capturing it.

No actionable P0, P1, or P2 findings remain in the reviewed states.

## Interaction and verification checks

- Public homepage returns HTTP 200 without authentication.
- Product tabs switch panels; keyboard Home returns focus and selection to the first tab.
- FAQ disclosures expand and expose their answers.
- The demo anchor reaches the video, and metadata confirms a duration of 176.1 seconds.
- English WebVTT captions load from the approved narration timing.
- The primary CTA reaches the existing signup form.
- Favicon, SVG icon, and Apple touch icon routes return HTTP 200.
- Desktop/mobile and light/dark checks found no horizontal overflow, page exceptions, or browser console errors.
- Production build and typechecking passed.
- All 95 focused token, proxy, and authentication-form tests passed.
- Repository-wide Biome CI checks passed across 530 files.

The authenticated deal workflow was not changed or exercised during landing-page verification.
The CI container smoke test now expects the public homepage's successful response instead of the previous redirect.

final result: passed
