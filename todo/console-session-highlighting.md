---
name: console-session-highlighting
type: feat
description: Syntax-highlight `$ cave …` shell-session code blocks on the website, embedding the CAVE highlighter for query patterns and CAVE output.
priority: medium
area: website
source: user request (2026-11-04), while adding EBNF highlighting to the Grammar page
---

# Console session highlighting

## Context

The docs contain about 49 shell-session fences (46 unlabeled, 3 `sh`) in
`README.md`, `examples/**/*.md`, and package READMEs. Each alternates
`$ command` lines with output, for example:

```
$ cave query --db repo.db '?p USES+ core'
?p = api-client
```

They render as plain text today. `website/src/components/Markdown.tsx` only
highlights `cave` fences (Tree-sitter, `CaveCode.tsx`) and `ebnf` fences
(`src/lib/ebnf-highlight.ts`). Both produce `Span[]` rendered by
`src/lib/render-spans.tsx`, so embedding works by highlighting a substring and
offsetting its spans.

## Scope

- Detect sessions: unlabeled, `sh`, or `console` fences whose lines begin
  with `$ `. Leave other fences unchanged.
- Command lines: prompt, command name, `--flags`, quoted arguments.
- Embedded CAVE: run the CAVE highlighter on the quoted pattern of
  `cave query` (and similar pattern-taking commands). CAVE-Q patterns such as
  `?p USES core` are not plain CAVE; confirm how the Tree-sitter grammar
  handles `?var` tokens and fall back to a small variable rule if needed.
- Output: highlight `?var = value` binding lines; send CAVE-shaped output
  (`cave export`, `appended: …`, review candidates) through the CAVE
  highlighter; render the rest as muted plain text.

## Done when

- Every session fence in the documentation renders without errors, and a test
  enumerates them so that new docs cannot regress unnoticed.
- Unit tests cover detection, command-line tokens, and span offsetting.
- The browser e2e suite (`website/test/e2e/`) passes.
- `website/README.md` documents the session highlighting rules.
