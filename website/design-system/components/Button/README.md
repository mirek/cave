Button and ButtonLink: a crisp 4px-cornered control; the filled kinds sit on a printed offset shadow and press into it.

## Props

- `variant`: `default` — ink fill on a `shadow-press-brand` orange offset · `brand` — `brand` fill, `on-brand` text, ink offset (`shadow-press`) · `secondary` · `outline` (`input` border) · `ghost` · `link` (underlined in `brand`, 2px). Default `default`.
- `size`: `sm` 32px · `default` 40px · `lg` 48px · `icon` 40×40.
- `Button` renders `<button type="button">`; `ButtonLink` an `<a>`. The consumer supplies the label and `href`/`onClick`; an optional `<span class="kbd">` shows a shortcut.

## Use

- One `default` per view for the main path ("Start the tutorial"). Use `brand` at most once per page, for the hands-on action ("Open playground"). Everything else is `outline`, `ghost` or `link`.
- Pressing moves the button 2px down-right into its shadow (`:active`); reduced motion turns the move off.
- Labels: sentence case, verb first. `→` only on `link`.
- Focus: 2px `ring` outline, 2px offset. Disabled: 45% opacity, no shadow.
