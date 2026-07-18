# @cavelang/tree-sitter-cave

Tree-sitter grammar for [CAVE](https://github.com/mirek/cave) — the
canonical grammar artifact behind editor and terminal highlighting.

The grammar is line-oriented (one claim per physical line, spec §16), so it
needs no external scanner: indentation is skipped and qualifier/continuation
lines are recognized by their leading verb. Parent attachment (spec §8) is
semantic and left to consumers such as `@cavelang/parser`.

Entity and attribute names accept Unicode letters, combining marks and
numbers, with `/`, `-`, `_`, and `.` as structural characters. Numeric
values include negative scalars and negative trajectory endpoints.

## Contents

- `grammar.js` — the grammar (spec §16, §3–§8)
- `queries/highlights.scm` — highlight captures (nvim/helix vocabulary);
  the single source used by `@cavelang/highlight` (terminal ANSI) and the
  CAVE VSCode extension (semantic tokens), including trajectory arrows as
  operators
- `src/` and `tree-sitter-cave.wasm` are committed generated artifacts.
  `pnpm grammar:verify` regenerates both with the pinned toolchain and fails
  when the result differs, so grammar changes remain reviewable.

## Rebuilding

`pnpm --filter @cavelang/tree-sitter-cave build` downloads the exact
tree-sitter CLI and WASI SDK archives listed in
`scripts/grammar-toolchain.json`, verifies their SHA-256 digests, and caches
them under `~/.cache/cave/grammar-toolchain`. Package installation itself
does not run a binary downloader.

For an offline or pre-provisioned build, copy the two archives for the host
platform into `$CAVE_GRAMMAR_CACHE/downloads` (the variable defaults to the
cache path above), then run:

```sh
CAVE_GRAMMAR_OFFLINE=1 pnpm grammar:prepare
```

Offline mode never accesses the network and reports the missing or invalid
archive, its expected digest, and the recovery command. Cached archives are
digest-checked on every invocation before an extracted tool is used.

## Consuming

The published entry points are `@cavelang/tree-sitter-cave/wasm` for the
generated grammar, `@cavelang/tree-sitter-cave/highlights` for the shared
query, and `@cavelang/tree-sitter-cave/package.json` for package metadata.

```js
import { Language, Parser } from 'web-tree-sitter'

const wasm = new URL(import.meta.resolve('@cavelang/tree-sitter-cave/wasm'))
const language = await Language.load(wasm.pathname)
```

Editors that consume tree-sitter directly (Neovim, Helix, Zed) point at this
directory; the grammar name is `cave` and file type is `.cave`.
