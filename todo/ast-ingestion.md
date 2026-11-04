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

## Completion evidence

AST module inventory is available in https://github.com/mirek/ast/pull/30
at `9738feb47035c32a4ff161adafa677ddba04e1f4`; upstream check/build and CI pass.
The generic Cave bridge is implemented as `Ast.connect` in the connector API,
with a real JSON adapter integration regression and pinned CI runtime.
The pnpm workspace command, fixture, runtime loader, self-ingestion queries,
and their user-facing documentation remain to implement in the next milestone.

The upstream milestone checkout is `.tmp/ast` on `feat/typescript-module-analysis`;
`.tmp/tools` contains pnpm shims. Both live under the Cave workspace and are
locally Git-ignored. Use `PATH="$PWD/.tmp/tools:$PATH"` from the Cave root.
Record the PR URLs and remaining dependencies here while work is active. Run
AST's check/build, Cave's appropriate package and CLI tests, a packed CLI smoke,
and end-to-end fixture and repository ingestion. Verify queries for package
dependencies, source imports, and JSDoc exports. Repeating an unchanged pass
must append no history; deleting a dependency/file must retract owned facts.
Review DOCUMENTATION.md and update all affected live surfaces per milestone.
Delete this task when the whole requested workflow is verified and PRs exist.
