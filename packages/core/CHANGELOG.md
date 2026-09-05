# @cavelang/core

## 0.33.0

### Patch Changes

- cdf4ed9: The storage schema's `cave_edge` role comment lists the roles that are actually stored, `WHEN`, `VIA`, `BECAUSE`, and `QUALIFIES`; an `UNLESS` qualifier is persisted as a `WHEN` edge to a negated child.
- 1320911: Describe CAVE by what it does in the README, website, book, CLI help, and MCP guide instead of leading with the SQLite storage backend; the storage engine remains a documented implementation detail behind the store adapter.
- 0adc7d2: The release script now waits up to about four minutes (8 attempts, 5s doubling to a 60s cap) for a just-published package to become visible on npm before tagging, instead of the 14s probe budget that failed the v0.32.3 run after every package had in fact published. Pre-publish registry probes keep their short budget.

## 0.32.3

### Patch Changes

- 7c1950a: Support Node.js 26 and record reproducible read-only CLI and narrow-screen website follow-up work from an exploratory product pass.
- 9c28743: Rewrite the root README and website home page as a step-by-step tutorial: Tutorial I builds a monorepo knowledge base one idea per step (claims, inverse and transitive queries, attributes, custom verbs, `cave connect`, sources and confidence, rules, shapes, cited reports, serve/MCP) and Tutorial II a market watchlist (theme exposure model, LLM news ingest, sign-aware rules, valid time, actions, automations, the brief), with new runnable fixtures under `examples/monorepo/` and `examples/market/`. The previous feature walkthrough moves unchanged to `examples/family-history/README.md` and joins the website's Learn section.

## 0.32.2

### Patch Changes

- a7397de: Update the release-automation guard test for the chained VS Code Marketplace publish job.
- a1f05bc: Publish the VS Code extension to Marketplace automatically after every npm release, listed as "CAVE Language".

## 0.32.1

### Patch Changes

- af53c4c: Publish the VS Code extension under the `MirekRusin` Marketplace publisher.

## 0.32.0

## 0.31.1

## 0.31.0

## 0.30.0

### Patch Changes

- afce4f3: Reuse immutable sensitivity-scoped view projections and invalidate them when the source store changes.
- 6035063: Exercise the production website's worker and WebAssembly playground flow in a real browser before deployment.
- 26b23cf: Validate packed TypeScript entry points and review public API declaration changes in CI.

## 0.29.1

### Patch Changes

- 3d2f5b9: Document the pnpm-based first-package bootstrap procedure after restoring coherent releases.

## 0.29.0

### Minor Changes

- 03373de: Add stable percent-escaped source-line provenance across ingestion, structured
  connectors, claim APIs, and cited reports.
- 5cd786d: Define claim history as permanent and document safe recovery from accidental sensitive-data ingestion across stores, exports, sync peers, and backups.

### Patch Changes

- 9022a00: Accept valid single-quoted YAML package names during version-PR validation.
- 75ed4cf: Record the project audit findings as prioritized, independently actionable backlog items.
- 8003648: Keep sync dry-runs from advancing the process UUID transaction clock.
- a606db4: Parse offset-less query timestamps as UTC across valid and transaction time.
- 662e6aa: Add MiniZinc to the formal-verification roadmap as the preferred candidate for
  finite-domain, combinatorial, and browser solving before a direct HiGHS adapter.
- 1f5ae77: Complete public package metadata and make bootstrap, clean, and workflow action versions deterministic.
- 3feae4f: Index live documentation and correct stale user, package, book, and website references.
- 27b1dc7: Record the MiniZinc backend decision and keep the TODO backlog limited to remaining work.
- 2f31c8f: Align two-token continuation classification and trailing-hyphen verb tokens across both parsers.
- f13c698: Separate version-PR recovery validation from exact publish validation so pending changesets can repair release identity drift safely.
- a4b41b9: Resolve evidence-gated language and listener proposals as explicit product boundaries and reconcile the active backlog.
- 5a96c95: Validate authoritative release commits and tags before npm setup, align the
  publish runtime with CI, cache the tree-sitter toolchain, and retry registry
  reads without confusing transient failures for unpublished packages.
- 01ca7dc: Classify date-like values with the shared calendar-period parser, including leap-day, month-length, and ISO week-year validation.
- 0ac44fd: Reject zero, negative, non-finite, and malformed uncertainty values consistently across parsing, claim construction, interpretation, and fusion.
- 0021db8: Generate VS Code changelog entries when synchronizing the extension release identity.
- 3526b49: Validate packed VSIX artifacts and add a lockstep, permission-scoped VS Code Marketplace release path.

## 0.28.1

### Patch Changes

- 16344ea: Harden the release publish script against partial publishes: the already-published guard now checks every public package (not a single sentinel), `pnpm -r publish` retries only publish what's missing, the `v<version>` tag is created on a later run if an earlier one published everything but died before tagging, and first-ever packages (which npm trusted publishing cannot cover until they exist on the registry) are called out up front.

## 0.28.0

### Patch Changes

- e2a4fd7: Release automation via changesets: PRs add a `.changeset/*.md` file instead of bumping versions in lockstep (which made every pair of concurrent PRs conflict); an automated Version Packages PR accumulates pending releases, and merging it bumps all version sources, publishes to npm and tags `v<version>`.
- a0a4dd1: Fix the release automation's first run: changesets/action builds the version packages PR body from each changed package's `CHANGELOG.md`, so `changelog: false` crashed it (ENOENT). Changelogs are now generated with the built-in `@changesets/cli/changelog`, and `scripts/sync-versions.mjs` no longer bumps the private website/VS Code manifests (changesets never writes changelogs for them, and the action treated their sync as a package release).
