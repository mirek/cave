# CAVE — TODO

Each backlog item is an independent, self-contained file in [`todo/`](todo/).

## Product and architecture

- [Push/listener ingestion](todo/push-listener-ingestion.md) — Add demand-driven continuous ingestion for push sources.
- [Core grammar variables](todo/core-grammar-variables.md) — Decide whether query variables belong in the core grammar.
- [Claim reification](todo/claim-reification.md) — Add nested claims only when a concrete use case justifies the syntax.
- [Temporal functions](todo/temporal-functions.md) — Design the gated temporal function layer.
- [Unify CLI dispatch](todo/unified-cli-dispatch.md) — Give synchronous and asynchronous commands one execution and error path.
- [Define a SQLite adapter](todo/sqlite-adapter-interface.md) — Replace build-time module aliasing with an explicit storage adapter boundary.
- [Centralize query primitives](todo/shared-query-primitives.md) — Share current-belief, alias, and temporal SQL instead of copying it.
- [Stabilize external records](todo/stable-external-records.md) — Define a versioned public JSON and record representation.
- [Decision and scenario layer](todo/decision-scenario-layer.md) — Support ephemeral overlays and typed external evaluation without polluting facts.
- [Formal verification and constraint solving](todo/formal-verification.md) — Add solver-backed feasibility, optimization, counterexamples, and unsatisfiable explanations.
- [Add `cave doctor`](todo/cave-doctor.md) — Diagnose runtime, database, extension, hook, and packaging problems.
- [Add performance benchmarks](todo/performance-benchmarks.md) — Track representative storage and query regressions in CI.
- [Paginate queries](todo/query-pagination.md) — Push limits into SQL and expose bounded iteration.
- [Make ingest strict by default](todo/strict-ingest-defaults.md) — Fail atomically unless lenient partial ingestion is explicitly selected.

## Correctness

- [Zoneless timestamps](todo/zoneless-timestamps.md) — Reject zoneless timestamps or interpret them consistently as UTC.
- [Comparison operator emission](todo/comparison-operator-emission.md) — Emit every comparison as valid, parseable CAVE.
- [Partial URL ingest failure](todo/ingest-partial-url-failure.md) — Isolate failed URLs instead of aborting unrelated healthy sources.
- [Digest path encoding](todo/ingest-digest-path-encoding.md) — Record digests safely for paths and URLs containing syntax characters.
- [Rules pass-limit retraction](todo/rules-max-passes-retraction.md) — Avoid false retractions when derivation stops at its pass limit.
- [Connect watch race](todo/connect-watch-race.md) — Attach watchers before the initial pass and handle filename-less events.
- [MCP protocol compliance](todo/mcp-protocol-compliance.md) — Negotiate supported versions and respond correctly to JSON-RPC batches.
- [MCP source-prefix normalization](todo/mcp-source-prefix-normalization.md) — Prevent `src:src:` provenance when users pass a prefixed source.
- [Report backtick citations](todo/report-backtick-citations.md) — Render declarations containing backticks as valid Markdown.
- [Async CLI error handling](todo/async-cli-error-handling.md) — Report async command failures with the same clean errors as sync commands.
- [Zero-sigma validation](todo/zero-sigma-validation.md) — Reject zero uncertainty and use one validated sigma implementation.
- [Calendar-date validation](todo/calendar-date-validation.md) — Make date classification and temporal parsing agree.
- [Alias disagreement attribution](todo/alias-disagreement-attribution.md) — Require a genuinely cross-name disagreement before reporting one.
- [Mixed-unit fusion](todo/mixed-unit-fusion.md) — Reject incompatible units at the library boundary.
- [Transitive depth truncation](todo/transitive-depth-truncation.md) — Remove or expose the silent 32-hop closure limit.

## Grammar and editor support

- [Negative and Unicode grammar](todo/parser-grammar-negative-unicode.md) — Align tree-sitter with accepted negative values and Unicode entities.
- [Trajectory arrow highlighting](todo/trajectory-arrow-highlighting.md) — Capture the trajectory arrow as an operator.
- [Parser classification drift](todo/parser-grammar-classification.md) — Align or document remaining hand-parser and tree-sitter differences.

## Performance

- [Set-based shape evaluation](todo/set-based-shape-evaluation.md) — Evaluate expectations without one full-store query per pair.
- [Seeded transitive queries](todo/seeded-transitive-queries.md) — Constrain recursive closure from bound endpoints.

## CI, release, and packaging

- [Run smoke tests in CI](todo/smoke-tests-in-ci.md) — Exercise packed artifacts before merge and publish.
- [Harden publish guards](todo/publish-workflow-guards.md) — Validate branch, version, runtime, cache, and retry assumptions.
- [Ship license files](todo/package-license-files.md) — Include complete license attribution in every package path.
- [Expand smoke coverage](todo/smoke-test-coverage.md) — Cover more commands, libraries, and reliable process cleanup.
- [Clarify typecheck and build](todo/typecheck-build-semantics.md) — Remove duplicate emitting builds or name them accurately.
- [Add a VS Code release pipeline](todo/vscode-release-pipeline.md) — Package, version, and publish the extension deliberately.
- [Polish package metadata and tooling](todo/package-tooling-metadata.md) — Complete manifests and make bootstrap, clean, and action pinning predictable.

## Documentation

- [Validate command documentation](todo/command-docs-coverage.md) — Detect CLI and MCP registry drift automatically.
- [Choose a documentation source of truth](todo/documentation-source-of-truth.md) — Generate or validate repeated command and API descriptions.

## Testing

- [Close integration test gaps](todo/integration-test-gaps.md) — Pin lifecycle, watcher, URL, and daemon behavior end to end.
- [Close edge-case test gaps](todo/edge-case-test-gaps.md) — Cover parser, MCP, escaping, FTS, time, alias, and unit boundaries.
