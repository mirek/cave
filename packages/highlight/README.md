# @cavelang/highlight

CAVE syntax highlighting for terminals — web-tree-sitter over the
[`@cavelang/tree-sitter-cave`](../tree-sitter-cave) grammar, colored by the
grammar's own `queries/highlights.scm` so terminal output and editor
highlighting share one source of truth. Explicit full-claim `@claim`
markers use keyword highlighting; reserved and numeric-looking subjects remain
entities, while a
trailing `@claim` remains a context label.

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
Theme lookup uses only the object's own entries, with the longest dotted prefix
winning; inherited properties never supply styles. Custom `paint` spans use
JavaScript UTF-16 offsets and must be ordered, non-overlapping integer ranges
within `0..text.length`, with `start <= end`. Adjacent and empty ranges are
allowed. Invalid ranges throw `TypeError` rather than silently duplicating or
truncating source text. The grammar-backed `spans()` already supplies valid
ordered ranges.
`paint()` captures the supplied range values before looking up theme styles.
Theme getters cannot rewrite those validated ranges or extend the in-progress
render by changing the caller's span array.

`highlighter()` shares one in-flight or successful initialization per process.
A failed initialization rejects its callers and clears that cache, allowing a
later call to retry after the underlying problem is repaired. It does not retry
automatically or create a retry loop.

The shared factory releases its compiled query and allocated parser if parser
setup fails. Per-call parse trees are released even when capture extraction
throws. `createHighlighter(language, querySource)` and
`createBrowserHighlighter(options)` return an `OwnedHighlighter`. Call its
`close()` when finished to release the parser and compiled query. Closing twice
is harmless; `spans()` and `ansi()` throw after closure. The initialized language
and WASM runtime are not unloaded.

When setup or capture fails and releasing its resources also fails, an
`AggregateError` retains the original error as its cause and first entry and
the cleanup error as its second entry. Multiple owned-resource cleanup failures
are retained in parser, then query order. Single errors propagate unchanged;
every resource release is attempted, and `close()` never retries failed cleanup.

`highlighter()` returns the shared `Highlighter` interface without `close()`;
its parser and query remain available for the process lifetime. The website's
cached browser highlighter likewise lives for the page lifetime. Components
borrowing that cache must not close it on unmount.
