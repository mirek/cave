# CAVE — TODO

Each backlog item is an independent, self-contained file in [`todo/`](todo/).

## Product and architecture

- [Value-shape expectations](todo/value-shape-expectations.md) — Add unit and cardinality constraints to `EXPECTS` and `cave check`.
- [Verb lifecycle](todo/verb-lifecycle.md) — Define in-band aliasing and deprecation for verbs.
- [Redaction and forgetting](todo/redaction-forgetting.md) — Decide and document how exceptional history rewriting works.
- [Sensitivity-aware export](todo/sensitivity-aware-export.md) — Filter exports and serving by an in-band sensitivity convention.
- [Source-span provenance](todo/source-span-provenance.md) — Point source provenance at the sentence or line range that produced a claim.
- [Typed client generation](todo/typed-client-generation.md) — Generate typed query helpers from in-band schema claims.
- [Push/listener ingestion](todo/push-listener-ingestion.md) — Add demand-driven continuous ingestion for push sources.
- [Core grammar variables](todo/core-grammar-variables.md) — Decide whether query variables belong in the core grammar.
- [Claim reification](todo/claim-reification.md) — Add nested claims only when a concrete use case justifies the syntax.
- [Temporal functions](todo/temporal-functions.md) — Design the gated temporal function layer.
- [Separate provenance dimensions](todo/provenance-dimensions.md) — Stop overloading context with actor, source, run, and domain identity.
- [Storage schema migrations](todo/storage-schema-migrations.md) — Version and migrate SQLite schemas explicitly.
- [Database-backed transaction ordering](todo/database-backed-transaction-order.md) — Allocate transaction order safely across concurrent processes.
- [Exact backup and restore](todo/exact-backup-restore.md) — Preserve transaction history and temporal semantics through backup and restore.
- [Consolidate the package surface](todo/package-surface-consolidation.md) — Reduce the number of independently published public artifacts.
- [Unify CLI dispatch](todo/unified-cli-dispatch.md) — Give synchronous and asynchronous commands one execution and error path.
- [Define a SQLite adapter](todo/sqlite-adapter-interface.md) — Replace build-time module aliasing with an explicit storage adapter boundary.
- [Centralize query primitives](todo/shared-query-primitives.md) — Share current-belief, alias, and temporal SQL instead of copying it.
- [Stabilize external records](todo/stable-external-records.md) — Define a versioned public JSON and record representation.
- [Decision and scenario layer](todo/decision-scenario-layer.md) — Support ephemeral overlays and typed external evaluation without polluting facts.
- [Add `cave doctor`](todo/cave-doctor.md) — Diagnose runtime, database, extension, hook, and packaging problems.
- [Add performance benchmarks](todo/performance-benchmarks.md) — Track representative storage and query regressions in CI.
- [Paginate queries](todo/query-pagination.md) — Push limits into SQL and expose bounded iteration.
- [Make ingest strict by default](todo/strict-ingest-defaults.md) — Fail atomically unless lenient partial ingestion is explicitly selected.

## Correctness

- [Lifecycle source-stamp bypass](todo/lifecycle-source-stamp-bypass.md) — Prevent authored `src:` contexts from escaping lifecycle ownership.
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
- [Synchronize tree-sitter version](todo/tree-sitter-version-sync.md) — Keep grammar metadata in the lockstep version bump.
- [Clarify typecheck and build](todo/typecheck-build-semantics.md) — Remove duplicate emitting builds or name them accurately.
- [Add a VS Code release pipeline](todo/vscode-release-pipeline.md) — Package, version, and publish the extension deliberately.
- [Polish package metadata and tooling](todo/package-tooling-metadata.md) — Complete manifests and make bootstrap, clean, and action pinning predictable.

## Documentation

- [Fix the README action example](todo/readme-action-example.md) — Make the documented `cave act` walkthrough executable.
- [Correct implementation documentation](todo/implementation-docs-accuracy.md) — Describe build output, dependencies, and comparison emission accurately.
- [Document temporal features](todo/temporal-docs-coverage.md) — Cover `--at`, trajectories, and temporal APIs across package READMEs.
- [Document command surfaces](todo/command-docs-coverage.md) — Add missing report, action-tool, hook, and read-only behavior.
- [Correct package README details](todo/package-readme-accuracy.md) — Fix smaller store, parser, and core API inaccuracies.
- [Replace retired roadmap references](todo/retired-roadmap-references.md) — Prefer specification references in help and package descriptions.
- [Choose a documentation source of truth](todo/documentation-source-of-truth.md) — Generate or validate repeated command and API descriptions.
- [Derive website versions](todo/website-version-source.md) — Remove hard-coded stale release numbers from the site.
- [Fix the website install command](todo/website-install-command.md) — Show a valid published-package installation path.

## Testing

- [Close integration test gaps](todo/integration-test-gaps.md) — Pin lifecycle, watcher, URL, and daemon behavior end to end.
- [Close edge-case test gaps](todo/edge-case-test-gaps.md) — Cover parser, MCP, escaping, FTS, time, alias, and unit boundaries.

## Project references

- [Project boundaries](todo/project-boundaries.md) — Preserve the permanent non-goals that keep CAVE local and small.
- [Retired roadmap](todo/retired-roadmap.md) — Resolve historical roadmap item and open-decision references.
