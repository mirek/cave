# @cavelang/tree-sitter-cave

Tree-sitter grammar for [CAVE](https://github.com/mirek/cave) — the
canonical grammar artifact behind editor and terminal highlighting.

The grammar is line-oriented (one claim or §8.5 shorthand fragment per
physical line), so it needs no external scanner: indentation is skipped,
qualifier/continuation lines are recognized by their leading verb, and a
low-precedence shorthand fallback keeps incomplete fragments highlightable.
Prefix expansion and parent attachment (spec §8) are semantic and left to
consumers such as `@cavelang/parser`.

Entity and attribute names accept Unicode letters, combining marks and
numbers, with `/`, `-`, `_`, and `.` as structural characters. Numeric
values include negative scalars and negative trajectory endpoints.

Explicit full claims use a leading `@claim` marker (§8.6), including inside
qualifier payloads. The marker is highlighted as a keyword and reserved or
numeric-looking subjects (such as `42` and `2026-01-01`) as entities; a trailing `@claim` is still a context. Prefix expansion remains the
semantic parser's responsibility.

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

The package test command also regenerates the native sources and WASM before
running the grammar corpus. Run workspace test matrices one Node version at a
time in a shared checkout: these commands write the same generated files and
use Tree-sitter's native parser cache. The workspace's package-concurrency
setting does not serialize two separate `pnpm test` processes.

Each missing archive download has a five-minute deadline covering connection
setup and the response body. Set `CAVE_GRAMMAR_DOWNLOAD_TIMEOUT_SECONDS` to a
positive number (up to 2147483.647) for slower links or shorter automation limits.
Invalid settings fail before cache creation. Failed transfers remove partial
files, and setup waits for both parallel preparations to settle before reporting
failure. Verified cached archives continue to support offline builds.
A local-server regression verifies timeout cleanup, corrected retry with
checksum-verified fixture archives, and an offline reuse pass with no requests.
A partial-failure case also verifies that a delayed successful archive remains
verified and installed when its peer returns HTTP 503; retry fetches only the
missing archive.
SDK setup validates the exact first line of `VERSION` before replacing an
existing installation; subsequent build metadata lines remain supported. A
missing or mismatched version leaves the prior installation intact and removes
the rejected staging directory. Cached installations with a version mismatch
are re-extracted from the verified archive, including in offline mode.
The same repair applies when installed version or source-marker metadata is a
directory instead of a file.
Staging cleanup also runs when reading version metadata or writing the source
marker fails, so malformed extracted files do not leave temporary SDK trees.
The fixtures test setup and cache behavior; the separate corpus run exercises
the real pinned tools.

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
