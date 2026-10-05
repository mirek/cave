Input: a 40px text field on `card` with an `input` border (3:1) and 4px corners.

## Props

- Any `<input>` attributes; `type` defaults to `text`. The consumer supplies a visible label (`meta` style above the field) or an `aria-label`.

## Use

- Placeholder in `muted-foreground` and shows an example, not the label.
- Focus: 2px `ring` outline, 2px offset.
- Query and code fields are textareas in `font-mono` on `code-bg`, not this component.
