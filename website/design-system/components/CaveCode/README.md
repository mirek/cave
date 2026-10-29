CaveCode: CAVE source on a dark `code-bg` slab in both themes — a lit terminal laid on paper — with orange verbs.

## Props

- `code`: the CAVE source. `lineNumbers`: two-digit `line-number` gutter. Default `false`.
- The consumer supplies the frame: `.code-frame` with an optional `<header>` (file name in `<b>`, a `meta` caption, three dots of which the first is `brand`) and an optional `<footer>` for a query and its result.

## Use

- Verbs (`USES`, `HAS`) are `syntax-keyword` orange and semibold: the brand appears in every example without decoration.
- Numbers and sources are teal (`syntax-number`, `syntax-label`), keys sand (`syntax-property`), strings sage, comments italic `syntax-comment`. All are ≥4.8:1 on `code-bg`.
- Text selection is the orange `selection` wash.
- In prose, inline code is `muted` with `radius-xs`, not a dark slab.
