# @cavelang/cli

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
