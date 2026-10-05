Card: raised paper (`card`) with a `border` hairline and 6px corners; flat by default, lifted onto an ink offset when it is a link.

## Props

- Any `<div>` attributes, or render as `<a class="ui-card">` for a whole-card link. The consumer supplies content and padding (`space-5`, 24px; `space-6` for feature cards).

## Use

- Put cards on a `muted` band so the raised paper reads; on `background` they rely on the hairline alone.
- Start a card with a `section-label` index (`§ 01`), then an `h3`, a `muted-foreground` sentence and, when there is one, a code snippet in a `code-frame`.
- A linked card hovers by moving up-left 2px onto `shadow-press` with an ink border. Never nest cards, never add a coloured side stripe.
