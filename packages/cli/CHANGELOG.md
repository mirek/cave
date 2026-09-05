# @cavelang/cli

## 0.35.0

### Minor Changes

- d64cad8: Declared sources (spec §23.4): `source/<name> HAS path: …` claims persist a `cave connect` invocation in-band, with `map`, `key`, `format`, `delimiter`, `table`, `sql`, and `records` attributes mirroring the options; a `.cave` path needs no map and is a lifecycle unit. `cave connect` with no source runs every declared source (`--list`, `--name`, `--force`, `--prune`, `--dry-run`, `--watch`, `--query`), `cave query --sources` overlays them in a rolled-back transaction, and a CAVE text file used as `--db` follows its declared sources on every open, in every surface. Declared sources stamp `@src:<name>/<key>` and keep digests under `source/<name>/<key>`, so the §26.3 policy on the same entity applies to what they yield. `@cavelang/connect` exports `Declared`, `assemble`, `declaredNaming`, `adHocNaming`, and `Source.loadSync`; `@cavelang/store`'s `openAt` and `openText` take an `assemble` hook.

### Patch Changes

- 0c9e0b7: Declared sources (spec §23.4): declarations are re-read after every followed source and a re-declared source runs again, so a `.cave` source that supersedes a path or mapping wins in passes, assembly, overlays, and dry runs alike; source names are one path segment, so they cannot collide with record keys; and a text store's `--sources` overlay recognizes record-only sources as already followed.
- Updated dependencies [d64cad8]
  - @cavelang/core@0.35.0
  - @cavelang/canonical@0.35.0
  - @cavelang/fusion@0.35.0
  - @cavelang/parser@0.35.0
  - @cavelang/query@0.35.0
  - @cavelang/store@0.35.0
  - @cavelang/highlight@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [0e502f1]
  - @cavelang/store@0.34.0
  - @cavelang/query@0.34.0
  - @cavelang/core@0.34.0
  - @cavelang/parser@0.34.0
  - @cavelang/canonical@0.34.0
  - @cavelang/fusion@0.34.0
  - @cavelang/highlight@0.34.0

## 0.33.0

### Minor Changes

- cdf4ed9: Rewrite the book as a 31-chapter course on one running example (a coffee roastery), and replay every runnable session in it against the real CLI (sessions that need a language model, a browser, a long-running server, or the optional Z3 solver package are marked `// no-test` and skipped): `scripts/book-examples.mjs` extracts `$`-prompt sessions and `#file` listings from `book/chapters/*.typ`, runs them in a scratch directory, and compares recorded output; `packages/cli/test/book.test.ts` runs it under `pnpm test`, and `--update` refreshes recorded output.
- 2ba7ab6: Add `cave search`, an FTS5 full-text search from the shell over the store's index (subject, verb, object, attribute name, value text, comment, and the raw line, so tags, contexts, and inverse spellings match too): one literal phrase by default, `--raw` for FTS5 MATCH syntax, `--limit` (default 100) with a trailing cap notice, and `--json` emitting a `cave.search/v1` object of `cave.claim/v1` records. `cave query` binding lines now end with the matched claim's comment (`?x = value  ; comment`) so the evidence written next to a claim reaches the reader. The `cave_search` MCP tool gains `limit` (default 100) and describes the indexed columns.

### Patch Changes

- cdf4ed9: `cave help --help` and `cave help help` print the help command's own usage instead of exiting 2 with an unknown-command error, so every command in the reference, `help` included, answers `--help`. `cave version`, `cave demo`, and `cave help` now reject surplus positional arguments with status 2, as `cave doctor` already did, instead of ignoring them; delegated commands such as `cave serve` keep reporting argument errors with status 1.
- Updated dependencies [cdf4ed9]
- Updated dependencies [1320911]
- Updated dependencies [857aa3c]
- Updated dependencies [0adc7d2]
  - @cavelang/core@0.33.0
  - @cavelang/parser@0.33.0
  - @cavelang/canonical@0.33.0
  - @cavelang/fusion@0.33.0
  - @cavelang/query@0.33.0
  - @cavelang/store@0.33.0
  - @cavelang/highlight@0.33.0

## 0.32.3

### Patch Changes

- 2a92792: Move `@modelcontextprotocol/server` from 2.0.0-beta.5 to the stable 2.0.0 release and bump `typst-community/setup-typst` to 5.3.

  CI's changeset job and `scripts/release-validate.mjs` now reject a changeset that names only packages outside the fixed release group (for example a private workspace such as `@cavelang/mcp`), since such a changeset would version that package without advancing the release; the changeset instructions say so explicitly.

- 4a7cf30: `cave doctor` no longer certifies nightly or release-candidate Node builds (for example `26.0.0-nightly…` or `24.0.0-rc.1`) as supported: only stable releases on the 22.18+, 24, and 26 lines pass the runtime check.
- Updated dependencies [658d9fb]
- Updated dependencies [7c1950a]
- Updated dependencies [9c28743]
  - @cavelang/parser@0.32.3
  - @cavelang/core@0.32.3
  - @cavelang/canonical@0.32.3
  - @cavelang/query@0.32.3
  - @cavelang/fusion@0.32.3
  - @cavelang/store@0.32.3
  - @cavelang/highlight@0.32.3

## 0.32.2

### Patch Changes

- Updated dependencies [a7397de]
- Updated dependencies [a1f05bc]
  - @cavelang/core@0.32.2
  - @cavelang/canonical@0.32.2
  - @cavelang/fusion@0.32.2
  - @cavelang/parser@0.32.2
  - @cavelang/query@0.32.2
  - @cavelang/store@0.32.2
  - @cavelang/highlight@0.32.2

## 0.32.1

### Patch Changes

- Updated dependencies [af53c4c]
  - @cavelang/core@0.32.1
  - @cavelang/canonical@0.32.1
  - @cavelang/fusion@0.32.1
  - @cavelang/parser@0.32.1
  - @cavelang/query@0.32.1
  - @cavelang/store@0.32.1
  - @cavelang/highlight@0.32.1

## 0.32.0

### Patch Changes

- Updated dependencies [377758f]
  - @cavelang/canonical@0.32.0
  - @cavelang/query@0.32.0
  - @cavelang/store@0.32.0
  - @cavelang/core@0.32.0
  - @cavelang/parser@0.32.0
  - @cavelang/fusion@0.32.0
  - @cavelang/highlight@0.32.0

## 0.31.1

### Patch Changes

- @cavelang/highlight@0.31.1
- @cavelang/core@0.31.1
- @cavelang/parser@0.31.1
- @cavelang/canonical@0.31.1
- @cavelang/store@0.31.1
- @cavelang/query@0.31.1
- @cavelang/fusion@0.31.1

## 0.31.0

### Minor Changes

- c9f5adc: Add version-matched CAVE usage guidance through the read-only `cave_help` MCP tool and publish a portable Agent Skill for CAVE workflows.

### Patch Changes

- @cavelang/core@0.31.0
- @cavelang/parser@0.31.0
- @cavelang/canonical@0.31.0
- @cavelang/store@0.31.0
- @cavelang/query@0.31.0
- @cavelang/fusion@0.31.0
- @cavelang/highlight@0.31.0

## 0.30.0

### Minor Changes

- 3ebe3e4: Serve CAVE through the official MCP TypeScript SDK v2 with modern protocol support and legacy fallback for GitHub Copilot CLI and older clients.

### Patch Changes

- 075a804: Run agents, hooks, and direct commands through one portable, output-bounded process-tree boundary.
- dbe8ad3: Define and continuously test the exact Node and operating-system support contract.
- Updated dependencies [afce4f3]
- Updated dependencies [6035063]
- Updated dependencies [26b23cf]
  - @cavelang/core@0.30.0
  - @cavelang/canonical@0.30.0
  - @cavelang/fusion@0.30.0
  - @cavelang/parser@0.30.0
  - @cavelang/query@0.30.0
  - @cavelang/store@0.30.0
  - @cavelang/highlight@0.30.0

## 0.29.1

### Patch Changes

- Updated dependencies [3d2f5b9]
  - @cavelang/core@0.29.1
  - @cavelang/canonical@0.29.1
  - @cavelang/fusion@0.29.1
  - @cavelang/parser@0.29.1
  - @cavelang/query@0.29.1
  - @cavelang/store@0.29.1
  - @cavelang/highlight@0.29.1

## 0.29.0

### Minor Changes

- 996e959: Make LLM ingestion atomic by default, add explicit lenient partial progress,
  and return complete per-source manifests with documented retry and exit rules.
- 9d3c617: Add SQL-bounded, transaction-snapshot-stable CAVE-Q pagination to the library,
  CLI, and MCP query surfaces, with protective defaults and opaque continuations.
- 0b6eb86: Expose command implementation APIs through stable `@cavelang/cli/<feature>`
  subpaths and bundle their private workspace packages into the CLI artifact.
- adb88b0: Create, verify, and atomically restore exact SQLite snapshots while preserving
  row identity, transaction order, provenance, lineage, and full history.
- e5ea4df: Add in-band exact-one cardinality and exact-unit constraints to `EXPECTS`,
  with actionable health reports and transactional gate enforcement.
- 8906d6a: Add storage-independent `cave.claim/v1` and `cave.query-match/v1` records with
  strict decoders and compatibility fixtures, and use them for CLI and federated
  JSON instead of serializing internal SQLite columns.
- b56c68b: Add `cave doctor` read-only runtime, installation, configuration, and store-health diagnostics with safe-to-share human and versioned JSON reports.
- 0977eee: Route every command through one promise-based dispatcher with consistent
  stack-free errors, injectable I/O, shared signal handling, awaited cleanup,
  and conventional signal exit codes. Set `CAVE_DEBUG=1` for diagnostic stacks.

### Patch Changes

- 33865f8: Require an explicitly conflicting cross-name pair before reporting an alias disagreement while preserving actor-attributed rows in genuine multi-alias conflicts.
- 49dc258: Harden ingest digest identities for arbitrary paths and URLs and report provenance write failures with source context.
- e7549c9: Expand packed-artifact smoke coverage across public libraries and offline commands.
- 4474a5a: Isolate URL ingestion failures per source and report retryable network and HTTP outcomes without discarding healthy inputs.
- 4604b1b: Emit every qualifier comparison with a valid canonical CAVE verb while preserving symbolic operator input and the existing `EXCEEDS` representation.
- 651d7c1: Guarantee that report default bullets and citation footnotes use CommonMark-safe delimiters around declarations containing backtick literals.
- 5b373d3: Close watcher startup races, expose deterministic connect runtime hooks, identify failed watch stages, and pin URL, debounce, retry, pruning, provenance, and live automation polling end to end.
- db1e38b: Pin MCP source-option validation to one documented unprefixed context form, with explicit coverage for prefixed, empty, and malformed values.
- d3978d0: Expose incomplete derivation status and preserve suspended conclusions and watermarks when the fixpoint pass limit is exhausted.
- 37ddc5b: Evaluate shape expectations from one indexed current-belief snapshot so SQL
  query count no longer scales with instances multiplied by expectations.
- 9082843: Include canonical license and author attribution files in every public package tarball.
- 2d3eea5: Rescan connect watch targets when filesystem events omit filenames, while preserving exact filtering for string and Buffer filenames.
- ee9d0e6: Gate pull requests, release publishing, and release tagging on the packed npm artifact smoke test.
- 35a8c61: Add deterministic cross-stack performance fixtures, recorded baselines, query
  plan evidence, and CI regression thresholds.
- 216ce5b: Validate MCP protocol negotiation and JSON-RPC batches over stdio.
- 33f7245: Export the shipped command registry and validate CLI and MCP reference tables against their commands, options, tools, parameters, and security boundaries.
- 046f8f6: Document every published entry point and validate package, website, specification, migration, and version projections against their authoritative registries.
- Updated dependencies [9022a00]
- Updated dependencies [75ed4cf]
- Updated dependencies [8003648]
- Updated dependencies [9d3c617]
- Updated dependencies [a606db4]
- Updated dependencies [03373de]
- Updated dependencies [662e6aa]
- Updated dependencies [1f5ae77]
- Updated dependencies [adb88b0]
- Updated dependencies [6f04273]
- Updated dependencies [c73479a]
- Updated dependencies [387edea]
- Updated dependencies [4d3cadc]
- Updated dependencies [364dce7]
- Updated dependencies [3feae4f]
- Updated dependencies [5cd786d]
- Updated dependencies [27b1dc7]
- Updated dependencies [2f31c8f]
- Updated dependencies [f13c698]
- Updated dependencies [a4b41b9]
- Updated dependencies [1ad5401]
- Updated dependencies [5a96c95]
- Updated dependencies [0fe8dfa]
- Updated dependencies [8906d6a]
- Updated dependencies [35a8c61]
- Updated dependencies [fe2706b]
- Updated dependencies [f4461c2]
- Updated dependencies [dbc0d59]
- Updated dependencies [01ca7dc]
- Updated dependencies [0ac44fd]
- Updated dependencies [0021db8]
- Updated dependencies [0f986d1]
- Updated dependencies [3526b49]
  - @cavelang/core@0.29.0
  - @cavelang/query@0.29.0
  - @cavelang/store@0.29.0
  - @cavelang/canonical@0.29.0
  - @cavelang/parser@0.29.0
  - @cavelang/fusion@0.29.0
  - @cavelang/highlight@0.29.0

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/automate@0.28.1
  - @cavelang/act@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/connect@0.28.1
  - @cavelang/eval@0.28.1
  - @cavelang/ingest@0.28.1
  - @cavelang/loop@0.28.1
  - @cavelang/mcp@0.28.1
  - @cavelang/parser@0.28.1
  - @cavelang/query@0.28.1
  - @cavelang/rules@0.28.1
  - @cavelang/shape@0.28.1
  - @cavelang/store@0.28.1
  - @cavelang/sync@0.28.1
  - @cavelang/view@0.28.1
  - @cavelang/highlight@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/act@0.28.0
  - @cavelang/automate@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/connect@0.28.0
  - @cavelang/eval@0.28.0
  - @cavelang/ingest@0.28.0
  - @cavelang/loop@0.28.0
  - @cavelang/mcp@0.28.0
  - @cavelang/parser@0.28.0
  - @cavelang/query@0.28.0
  - @cavelang/rules@0.28.0
  - @cavelang/shape@0.28.0
  - @cavelang/store@0.28.0
  - @cavelang/sync@0.28.0
  - @cavelang/view@0.28.0
  - @cavelang/highlight@0.28.0
