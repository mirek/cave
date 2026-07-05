# @cavelang/tree-sitter-cave

Tree-sitter grammar for [CAVE](https://github.com/mirek/cave) — the
canonical grammar artifact behind editor and terminal highlighting.

The grammar is line-oriented (one claim per physical line, spec §16), so it
needs no external scanner: indentation is skipped and qualifier/continuation
lines are recognized by their leading verb. Parent attachment (spec §8) is
semantic and left to consumers such as `@cavelang/parser`.

## Contents

- `grammar.js` — the grammar (spec §16, §3–§8)
- `queries/highlights.scm` — highlight captures (nvim/helix vocabulary);
  the single source used by `@cavelang/highlight` (terminal ANSI) and the
  CAVE VSCode extension (semantic tokens)
- `src/` (generated parser) and `tree-sitter-cave.wasm` are **not
  committed** — generated artifacts are unauditable, so `pnpm build`
  produces both on demand (tree-sitter-cli fetches wasi-sdk itself; no
  emscripten or docker). They ship inside the npm tarball via `prepack`,
  and `pnpm test` builds them before running the corpus.

## Consuming

```js
import { Language, Parser } from 'web-tree-sitter'

const wasm = new URL(import.meta.resolve('@cavelang/tree-sitter-cave/wasm'))
const language = await Language.load(wasm.pathname)
```

Editors that consume tree-sitter directly (Neovim, Helix, Zed) point at this
directory; the grammar name is `cave` and file type is `.cave`.
