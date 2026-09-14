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
at `3f84949d1895c36269ef1d1e173f945c8a3b8b53`. Both review rounds are fixed,
with public regressions for default/type-only exports, export assignment,
namespace identity, statement JSDoc and syntax-only JSX traversal. Upstream
check/build pass; the latest CI/review remain to inspect.

The generic bridge is in https://github.com/mirek/cave/pull/248 at `9d14774`;
all CI checks pass. The current `feat/ast-pnpm-workspace` branch adds the
workspace CLI, fixture, real-runtime CI on all supported platforms, documentary
comments, package/file/import/export queries and refreshed documentation/book.
All 258 connector tests pass with the pinned runtime. Packed CLI smoke passes with actual fixture ingestion and a zero-change repeat.
Self-ingestion produces 3,956 records without failures; its final repeat maps zero records, skips all 3,956 and changes no claims. A full CLI run exposed the book doctor
example's assumption that TMPDIR is outside a workspace; its documented pnpm
placeholder now permits either successful context and still rejects FAIL.
Both focused book regressions pass after that adjustment and disabling Node
compile caching inside the cleanup test. The complete chapter replay also passes.

Workspace milestone: https://github.com/mirek/cave/pull/249, targeting
`feat/ast-ingestion` (parent unmerged). CI and reviews are running.
Inspect final checks and all review threads before declaring the work finished.
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

## Workspace milestone implementation notes

Use the existing `@cavelang/loop` direct process boundary to run
`pnpm list --recursive --depth -1 --json` in the selected root (verified on
Cave: includes the root and all 25 packages). This delegates workspace YAML
semantics/globs to pnpm and avoids another parser dependency. Validate the
returned package paths stay within the root. Read manifests through AST JSON
traversal; preserve dependency category and exact authored range. Use AST
filesystem traversal for source files and `TypeScriptAdapter.moduleInfo` with
the nearest appropriate tsconfig; preserve syntax-only diagnostics where no
project applies. The optional AST runtime loader should resolve @mirek/ast
from the caller project or accept an explicit built module path.

Keep temporary files/checkouts and TMPDIR under Cave `.tmp/` per user request.
Tool shim path is `/Users/mirek/github/mirek/cave/.tmp/tools`; AST checkout
uses pnpm 11.13.0, Cave uses 11.9.0. Invoking bare pnpm without the shim finds
9.12.3. Upstream check log: `.tmp/ast-review-check.log`; connector log:
`.tmp/connect-check.log`; successful packed smoke log: `.tmp/ast-smoke.log`.

## Review follow-up

AST PR #30 at `3f516fc` now keeps import targets and declaration revisions tied
to compiler snapshots and includes exported import-equals aliases. Three public
regressions fail before the fix; upstream check/build pass. All nine findings
so far have replies and resolved threads; another review is running.

Bridge PR #248 at `7ee44f9` explicitly closes custom iterators when next rejects
and preserves simultaneous cleanup errors. Its 256 tests pass with the real
runtime. The workspace branch merges that fix. Windows testing exposed a test
runtime import needing file URLs and a provenance assertion needing escaped
backslashes; both are fixed, and workspace ingestion itself passed on Windows.

Workspace PR #249 review fixes distinguish compiler-resolved local aliases and
Node built-ins from npm packages, and support roots without package manifests.
Uncontained root sources belong to the workspace entity. All four real-runtime
workspace scenarios pass. Inspect the final connector/build logs and latest CI,
reply/resolve these two findings after pushing, and finish the review loop.
