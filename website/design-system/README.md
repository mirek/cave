CAVE is a plain-text language for claims and a local store that answers questions over them. The look is **warm technical**: a well-printed field manual. Warm paper, real ink, mono labels with section marks, code on a lit dark slab, and one signal orange that marks what matters. It should feel precise and calm, never like a startup landing page.

## Content fundamentals

- **Voice: plain, declarative, concrete.** Short sentences that say what the tool does. "Write down what you know, one claim per line. Ask questions across all of it." · "One idea per step." · "Nothing leaves the browser."
- Address the reader as "you". The project is "CAVE" (all caps), never "we".
- **Casing:** sentence case for headings, buttons and badges. UPPERCASE only for mono labels (`§ 02 — HOW IT'S TAUGHT`, `PLAIN TEXT`) and for CAVE verbs (`USES`, `HAS`).
- **Show, then tell.** Every claim is backed by a real snippet, and outputs shown come from real runs. Never invent output.
- Number sections and steps with a section mark and two digits: `§ 01`, `§ 02`. No emoji. Glyphs: `→` for onward links, `↗` for external ones, `$` before shell commands (in `brand-ink`).

## Visual foundations

### Colour

- Two themes. **Paper** (light, first): `background` #f6f1e7 with `foreground` ink #1c1814. **Lamp** (dark): `background` #14110e with `foreground` #f1e9dc. Every pair below holds in both.
- Three paper levels: `background` for the page, `card` for raised panels and `muted` for sunk bands and sidebars. Alternate `background` and `muted` bands to pace a long page, and put cards on `muted`.
- `brand` (#ff6b2c, signal orange) is the only hue in the chrome, and it is used **small**: the bar in the mark, badge dots, the offset under the ink button, strip markers, the link underline, the active-nav bar. Use it as a large fill at most once per page (one `brand` button or the cover). On paper it is 2.5:1, so never set text or hairlines in it there. Text on a `brand` fill is `on-brand` ink.
- `brand-ink` is the readable orange: section labels, link hover, the `$` prompt. `brand-tint` is a highlighter wash for one phrase per heading (`.hl`) and for the brand badge.
- `muted-foreground` carries secondary copy at ≥5.9:1 on every ground. `border` is for decorative hairlines. `input` (≥3:1) outlines controls.
- `destructive` is crimson, kept apart from the orange, and always goes with a word ("Error").
- Code always sits on `code-bg`, which is dark in both themes. Syntax colours: orange verbs (`syntax-keyword`), teal numbers and sources, sand keys, sage strings and italic comments. All are ≥4.8:1.

### Type

- **IBM Plex Sans** for reading and **IBM Plex Mono** for labelling and code, both from Google Fonts (`family=IBM+Plex+Sans:wght@400;500;600` and `family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400`). The stacks fall back to system faces.
- Headings are Plex Sans at weight 600 with tight tracking: `hero` 76px, `section` 52px, `page` 44px, `h2` 28px and `h3` 21px. Never go above 600.
- Reading text: `lead` 20/1.6 in `muted-foreground`, `body` 17/1.65, with lines at most 70 characters.
- Mono does the labelling: `label` (11px, 600, 0.16em, UPPERCASE, `brand-ink`) above every section, `meta` (11px, 0.08em, UPPERCASE, `muted-foreground`) for captions, file names and status. The wordmark "CAVE" is mono at 600 with 0.18em tracking.

### Space and layout

- 4px base: `space-1`–`space-9` (4, 8, 12, 16, 24, 32, 48, 64, 96). Sections get `space-9` vertical padding on desktop and `space-8` on phones. The gutter is `space-7` (`space-5` on phones). Content is capped at `content-max` (1200px).
- Use an asymmetric editorial grid: a narrow label column (`§ 02 — HOW IT'S TAUGHT`) beside wide content, the way a manual sets marginalia.
- Graph paper: a 1px `border` dot every 24px may sit behind the hero only.

### Shape, depth, motion

- Crisp corners: `radius-xs` 2px for inline code and chips, `radius-control` 4px for controls, `radius` 6px for cards and code frames. `radius-pill` is only for status dots.
- No blurred shadows. Depth is **printed**: `shadow-press-brand` (an orange 3px offset) under ink buttons and `shadow-press` (an ink offset, cream in Lamp) under the brand button and hovered link cards. Pressed buttons move 2px into a 1px offset.
- Motion: 120–150ms colour and offset transitions only. `prefers-reduced-motion` removes all movement.

### States

- Hover: ink fills lighten (`primary-hover`), outlines go ink, ghost items gain `accent`, links turn `brand-ink`, link cards lift onto `shadow-press`.
- Focus: always a 2px solid `ring` outline at 2px offset (≥4.7:1 on every ground in both themes).
- Active nav: `foreground` text with a 2px `brand` bar resting on the header rule. Disabled: 45% opacity with no shadow.
- Selection: the orange `selection` wash.

## Iconography

- No icon font. Use text glyphs (`→`, `↗`, `$`, `§`), 6–8px squares or dots in `brand` as list and strip markers, and the three-dot code header in which the first dot is `brand`.
- Diagrams are inline SVG with 1.25px `foreground` strokes, `border` axes and at most one `brand` mark per diagram for the thing being explained.

## Logo

- The mark is the geometric C with its middle bar in signal orange, like a cursor waiting inside the cave. Use `cave-mark.svg` on Paper and `cave-mark-dark.svg` on Lamp. Inline in the header, `.logo-ink` takes `currentColor` and `.logo-bar` takes `brand`.
- Place it beside the mono wordmark at 26px. On phones show the mark alone.
- The favicon is the C in solid `brand`.

## In this repository

This folder is the repository copy of the CAVE design system, published as a
Design System artifact at <https://claude.ai/artifact/WcgiXJ9MtZB7M9Lqm9v8i2>.
`tokens.json` holds every token with its usage note; `components/` holds the
guidelines and previews; `assets/Logos/` holds the mark and favicon.

The website (`website/src/styles.css`) implements it:

- **Colour tokens** are CSS custom properties on `:root` with the token names
  used here (`background`, `foreground`, `muted`, `brand`, `code-bg`…), read
  as `var(--x)`. Lamp follows `prefers-color-scheme: dark`; there is no manual
  theme switch.
- **Fonts:** IBM Plex Sans and Mono are bundled from `@fontsource` (Latin
  subsets, the weights listed above) instead of Google Fonts, so the site makes
  no third-party font request. `theme-color` follows `background` per scheme
  and the favicon is the C in solid `brand`.
- **Components:** the button, badge, card, input, code-frame, logo and
  site-header rules from `components/bundle.css`, under the site's own class
  names. Every code block, the hero console and the playground editor sit on
  `code-bg` in both themes. Section labels carry `§ NN —` prefixes in
  `brand-ink`.
- Change a token here and in `styles.css` together; the artifact is the
  editing surface, this folder the reviewed record.
