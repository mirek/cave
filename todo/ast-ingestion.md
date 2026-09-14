---
name: ast-ingestion
type: feat
description: Integrate mirek/ast with Cave and ingest a pnpm monorepo deterministically.
priority: high
area: connect
source: user request
---

## Outcome

Use mirek/ast's public adapters to extract structured source knowledge into
Cave. Ship a reproducible pnpm monorepo example covering package identity,
dependency categories and ranges, source ownership, imports between files and
packages, and exported symbols with JSDoc. Keep execution outside the core
claim grammar; this work does not implement document mutation.

## Milestones and PR boundaries

1. AST repository: public TypeScript module analysis with import/re-export
   specifiers, compiler-resolved local targets where available, exported
   declarations and JSDoc. Test aliases, type-only imports, unresolved modules,
   and declaration/export identity. Preserve source revisions and diagnostics.
2. Cave repository: AST-backed ingestion API and command using an explicitly
   loaded optional runtime (AST is currently unpublished). Support generic AST
   query records and the pnpm workspace workflow; reuse connector templates,
   ownership reconciliation, and strict publication. Test real AST integration
   as well as failures, cancellation, idempotence, and removal.
3. Cave repository: runnable pnpm fixture and self-ingestion example, queries,
   documentation, packed API verification, and CI coverage. Open milestone PRs
   rather than accumulating unrelated changes in one PR.

## Design constraints

- AST owns syntax and compiler semantics; Cave must not parse TypeScript with
  regular expressions or copy AST's compiler implementation.
- Node identity is scoped to an observed source revision; package/file/symbol
  facts use documented logical identities independent of byte offsets.
- Exact dependency ranges and dependency categories remain queryable.
- Successful refresh reconciles only its owned facts, including disappeared
  files and dependencies. A failed extraction must not prune valid knowledge.
- Source parsing errors are diagnostics, not an empty successful source.
- The default runtime is @mirek/ast resolved from the caller project; an explicit
  built module path supports the sibling checkout without an unpublished npm
  dependency or a machine-specific committed path.
- Ingestion reads external documents; it does not change source files or claim
  atomicity across files and Cave's store.

## Current milestones and verification

- AST module analysis: https://github.com/mirek/ast/pull/30 at `da33f32`.
  Public regressions cover import/export identity, JSDoc, JSX, captured import
  resolution and source-revision correspondence. `pnpm check` and `pnpm build`
  pass. Nine review findings have replies and resolved threads. A further
  regression preserves exported type-only import-equals aliases in both modes.
- Generic bridge: https://github.com/mirek/cave/pull/248 at `7ee44f9`.
  Explicit iterator cleanup covers rejecting next calls and simultaneous cleanup
  errors. All 256 connector tests pass with the real runtime. Re-review completed
  without new findings. Last CI observation: all checks green except Windows
  runtime still running.
- Workspace workflow: https://github.com/mirek/cave/pull/249, stacked on
  `feat/ast-ingestion`. All 261 connector tests and the CLI build pass. All 258
  CLI tests passed, and packed smoke passed again with the final reviewed runtime; current real-runtime
  scenarios cover fixture ingestion, unchanged refresh, removals, syntax-error
  rollback, JSDoc, local aliases, Node built-ins and manifestless workspace roots.
  Both workspace review findings have replies and resolved threads. Real workspace
  tests passed on Windows; test import URLs and provenance escaping were corrected
  after extending the platform CI job to the full connector suite.
- Latest Cave self-ingestion produced 3,957 records without failures. Repeating it
  mapped zero records, skipped all 3,957 and added/retracted zero claims. Package,
  import and export queries were verified. Documentation checks and book replay
  pass; the updated book PDF was rendered and inspected.

## Remaining work

Inspect final CI and reviews for all three PRs, especially the final AST runtime
pin and Windows run. Fix or answer any new findings and resolve each thread.
Keep the workspace PR stacked until its parent is merged; this task does not
require merging or publishing the PRs. Delete this task and its TODO.md entry
when the requested workflow and final review gates are verified.

Temporary work stays within Cave `.tmp/` per the user's request. `.tmp/ast` is
the upstream checkout, `.tmp/bridge` is the bridge review worktree, and
`.tmp/tools` contains Corepack pnpm shims. Set PATH to include that shim directory
and TMPDIR to `.tmp/runtime` for every local command. Use the Cave-root absolute
paths when running from a temporary checkout. Test logs and self-ingestion
reports are under `.tmp/`; the latest are `workspace-review-all.log`,
`workspace-review-build.log`, `ast-type-import-check.log`,
`ast-type-import-build.log`, and `cave-ast-reviewed-repeat.json`.
