SiteHeader: the sticky 60px bar with the mark and mono wordmark on the left, centred navigation, and one outline action on the right.

Source: the `<header className="site-header">` in `website/src/App.tsx`.

## Parts

- `.logo`: inline SVG mark (`.logo-ink` takes `currentColor`, `.logo-bar` is `brand`) and the wordmark "CAVE" in `wordmark` style. Under 720px the wordmark hides.
- `nav .nav-link`: `muted-foreground` at rest, `foreground` on hover with an `accent` fill. The current route has `aria-current` and a 2px `brand` bar sitting on the header's bottom rule.
- `.header-cta`: one `outline` `sm` button.

## Use

- Background `header-glass` with a 12px backdrop blur and a `border` bottom rule.
- Never put a filled button here; the page's own hero carries the primary action.
