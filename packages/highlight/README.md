# @cavelang/highlight

CAVE syntax highlighting for terminals — web-tree-sitter over the
[`@cavelang/tree-sitter-cave`](../tree-sitter-cave) grammar, colored by the
grammar's own `queries/highlights.scm` so terminal output and editor
highlighting share one source of truth.

```ts
import { highlighter } from '@cavelang/highlight'

const { ansi, spans } = await highlighter()
process.stdout.write(ansi('auth/middleware USES jwt @ 90% #security\n'))
```

- `spans(text)` — flat, non-overlapping `{ start, end, capture }` ranges
- `ansi(text, theme?)` — ANSI-colored text; themes map capture names (or
  dotted prefixes, longest wins) to SGR parameters
- `paint(text, spans, theme?)` — renderer, exported for custom span sources
- `@cavelang/highlight/browser` — browser factory accepting emitted parser
  and language WASM URLs plus the shared highlights query

The default theme leaves entities uncolored — they are the bulk of every
line; color carries the structure (verbs, values, metadata, comments).
