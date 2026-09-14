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

## Current verification and remaining work

- AST module analysis: https://github.com/mirek/ast/pull/30 at `bbc7cd8`.
  All fifteen review findings have fixes, public regressions, replies and
  resolved threads. Full `pnpm check` and `pnpm build` pass. Re-review is running.
- Generic bridge: https://github.com/mirek/cave/pull/248 at `7ee44f9`.
  Clean re-review and green CI, including real-runtime connector tests.
- Workspace workflow: https://github.com/mirek/cave/pull/249, stacked on
  `feat/ast-ingestion`. Clean re-review and green CI at `efb516b`.
  Both CI runtime refs and the example README now target `bbc7cd8`.
- All 261 connector tests and 258 CLI tests passed. Packed smoke verifies the
  real AST fixture, 19 records and an unchanged refresh. Documentation and
  book replay pass; the updated book PDF was rendered and inspected.
- Cave self-ingestion at `cfb24b6` produces 3,957 unchanged records: zero mapped,
  added or retracted claims and no failures. Packages/imports/exports queries
  were verified. The latest upstream change only excludes unresolved namespace
  re-export syntax from local-name inference.

Wait for clean upstream re-review and final pinned CI, including Windows.
Fix or answer any new findings and resolve their threads. Delete this task and
its TODO.md entry once the final review gates pass. Keep the workspace PR
stacked until its parent is merged; merging/publishing is outside this task.

Temporary work stays within Cave `.tmp/` per the user's request. `.tmp/ast` is
upstream, `.tmp/bridge` is the bridge worktree, `.tmp/tools` contains Corepack
shims, and `.tmp/runtime` is TMPDIR. Use absolute Cave-root PATH/TMPDIR in
sub-checkouts. Latest logs: `ast-unresolved-check.log`,
`ast-unresolved-build.log`, `workspace-local-binding-runtime.log`, and
`cave-final-pin-command.json`.
