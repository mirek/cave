The CAVE mark: the website's rectangle-built C (geometry from `website/src/components/Logo.tsx`, 44-unit grid), with its middle bar in signal orange.

- `cave-mark.svg`: for Paper. The C is ink `foreground` (#1c1814) and the bar is `brand` (#ff6b2c).
- `cave-mark-dark.svg`: for Lamp. The C is `foreground` in Lamp (#f1e9dc) and the bar is `brand`.
- `cave-favicon.svg`: the C alone in solid `brand` (64-unit grid, from `website/index.html`). Use it for browser tabs and app icons. Anywhere larger, use a mark.

Clear space is at least the bar's height on every side. Never recolour the bar, never set the mark in `brand` on paper and never outline it. An `<img>` cannot inherit colour, so pick the file by theme or inline the SVG with `.logo-ink` / `.logo-bar` classes.
