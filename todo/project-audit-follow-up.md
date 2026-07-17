---
name: project-audit-follow-up
description: Restore release coherence and close confirmed scalability, process-safety, compatibility, packaging, and browser-runtime gaps.
priority: high
area: project
source: Codex repository audit
audited-commit: a4b41b97af33e36f4d38426575102d9eb57f860f
audited-at: 2026-07-17
---

# Project audit follow-up

## Outcome

CAVE has a coherent architecture, unusually broad behavioral tests, strict
TypeScript settings, explicit storage migrations, verified backups, packed
artifact smoke tests, fail-closed sensitivity labels, and narrow project
boundaries. The audit did not find a reason to replace SQLite, collapse the
package graph, add hosted or multi-tenant machinery, or reopen any decision in
`PROJECT-BOUNDARIES.md`.

The principal limiting factor is operational rather than conceptual: the
release state is already split across the repository and npm, while two
append-only and external-process boundaries have costs or guarantees that do
not scale with the promises made by their public surfaces. Address these
before extending the language.

## Audit scope and evidence

The audit covered the `main` branch at
`a4b41b97af33e36f4d38426575102d9eb57f860f`, including all workspace package
manifests, source and test files, public documentation and specification
skills, CI/release/deployment workflows, package consolidation, browser and
VS Code surfaces, and the current npm registry state.

Evidence collected during the audit:

- The workspace contains 25 member packages/products, 281 TypeScript or
  JavaScript source files, and 97 test files.
- A composite TypeScript build succeeds under TypeScript 5.9.3.
- `pnpm audit --prod` reports no known production dependency vulnerabilities.
- `node scripts/release-validate.mjs --if-release-ready` fails on committed
  version drift: `@cavelang/solver-z3` is `0.28.0` while the repository release
  identity is `0.28.1`.
- There are 67 pending changesets and no open version-packages pull request.
- At audit time, npm reports `@cavelang/core` at `0.28.1`, most other existing
  public packages at `0.27.14`, and no published package for
  `@cavelang/scenario` or `@cavelang/solver-z3`.
- A clean dependency install blocks while `tree-sitter-cli` downloads an
  executable from a GitHub release. The dependency's install script performs
  no content-hash verification; grammar WASM generation has a second external
  WASI SDK download.
- The default sensitivity-scoped `topics()` read over 5,000 rows took about
  433 ms, versus about 9 ms for the direct `restricted` read, because the
  default path rebuilds an in-memory store. This is a representative
  measurement, not a stable cross-machine budget.

## Priorities

| Priority | Work | Risk addressed |
|---|---|---|
| P0 | Restore one authoritative release state | Release automation is blocked and public packages are split across versions. |
| P1 | Replace per-request sensitivity snapshots | Every ordinary view read copies permanent history, so latency grows with every append. |
| P1 | Harden the external-process boundary | Shell quoting is POSIX-only, timeouts do not guarantee descendant termination, and output is unbounded. |
| P2 | Test the advertised runtime and platform contract | Packages accept all Node versions from 22.18 onward, but CI exercises one Node version on Linux only. |
| P2 | Validate packed type and API contracts | Runtime smoke tests do not prove that published declarations or semver surfaces remain consumable. |
| P2 | Exercise the production browser product | The site builds and its adapter is tested in Node, but no browser test uses the shipped bundle. |
| P2 | Make grammar builds verifiable and network-resilient | Routine install, CI, and release depend on unverified postinstall/toolchain downloads. |
| P3 | Automate dependency and action maintenance | Pinned dependencies are currently clean but have no visible update or recurring audit workflow. |

## P0 — restore one authoritative release state

### Problem

The preflight intended to skip publishing while changesets are pending first
enforces lockstep versions. A new fixed-group package can therefore prevent
the changesets action from creating the version PR that would align it. The
current test fixture covers release commits and tags but not the
`--if-release-ready` path with a pending changeset and pre-version package
state.

The failure has propagated beyond CI: repository manifests, published npm
versions, pending changesets, first-time package publication, and tags no
longer describe one release.

### Direction

Separate two preflight modes explicitly:

1. **Version-PR mode:** with pending changesets, validate the branch,
   committed inputs, changeset shape, and version topology needed to run
   `changeset version`, then allow `changesets/action` to create or update its
   PR. Do not grant this mode permission to publish or tag.
2. **Publish mode:** with no pending changesets, require every public manifest,
   generated version projection, commit, tag, and npm publication input to be
   exactly aligned before OIDC or mutation.

Add a normal CI invariant for fixed-group membership and baseline versions so
that adding a public package cannot silently introduce version skew. Document
the one legitimate initialization rule for a new package without weakening
the rule that ordinary PRs never bump versions manually.

Repair the live release after the control flow is fixed. Bootstrap the first
publication of `@cavelang/scenario` and `@cavelang/solver-z3`, configure their
npm trusted-publisher identities, and let the partial-publish-safe path repair
or supersede the fragmented release deliberately.

### Done when

- A regression reproduces the current pending-changeset/version-skew deadlock
  and passes with the corrected two-mode preflight.
- Normal CI rejects an incorrectly initialized fixed-group package before it
  reaches `main`.
- The version-packages PR is created or updated from the 67 pending
  changesets and receives the expected validation.
- All 12 public packages resolve from npm at one intended version, including
  the two first-time packages; their internal dependency versions agree.
- The matching repository commit, `v<version>` tag, root manifest, public
  package manifests, tree-sitter metadata, and VS Code release identity agree.
- Rerunning the release is a green no-op and the next ordinary changeset again
  updates the version PR.

## P1 — replace per-request sensitivity snapshots

### Problem

`packages/view/src/scope.ts` copies every visible claim and edge into a fresh
in-memory database for each default `overview`, `entity`, `topic`, `history`,
`lineage`, and report read. This correctly prevents indirect sensitivity
leaks, but it makes a bounded read O(total visible history) before its actual
query begins. CAVE history is permanent, so the penalty grows monotonically;
concurrent HTTP requests multiply the copy and memory cost.

The existing performance gate covers import, export, resolution, shape,
bounded query, and transitive query workloads, but not the view/report
sensitivity boundary.

### Direction

Preserve the fail-closed semantics while making visibility part of the query
boundary. Prefer parameterized scoped SQL/read APIs that filter claim rows,
edge endpoints, counts, alias closure, shape checks, history, search, and
lineage at source. If that makes the store API disproportionately complex,
evaluate a cache keyed by `(database identity, maximum sensitivity, max tx)`;
it must be invalidated atomically and must never serve a wider snapshot to a
narrower audience.

Do not optimize by filtering only final JSON. Hidden rows must remain absent
from intermediate counts, current-belief selection, aliases, disagreement
groups, FTS results, and graph traversal.

### Done when

- Cross-sensitivity conformance tests retain every current non-leakage
  guarantee, including hidden current rows superseding visible history and
  edges with one hidden endpoint.
- Repeated scoped reads do not rebuild all visible rows and edges per request.
- A checked-in benchmark covers at least 5,000 and 50,000 rows with history,
  tags, and edges and sets a generous CI regression budget.
- The benchmark records time and peak-memory evidence for overview, entity,
  history, lineage, search, and report paths.
- `ARCHITECTURE.md`, `IMPLEMENTATION.md`, and the view documentation explain
  the resulting visibility boundary.

## P1 — harden the external-process boundary

### Problem

Actions, automations, ingestion, and loop policies independently spawn shell
commands. Placeholder values use POSIX single-quote escaping while
`shell: true` selects the platform shell; on Windows, `cmd.exe` does not treat
single quotes as quoting. The stated injection-safety guarantee is therefore
not portable.

Timeouts terminate the immediate shell but may leave descendants running.
Some implementations explicitly stop waiting for inherited pipes without
stopping the process tree. Agent stdout is accumulated without a byte limit,
so a faulty or hostile child can exhaust memory before its time limit.

### Direction

Create one external-command runner shared by act, automate, ingest, eval, and
loop. Give it a precise contract for executable/arguments, environment,
working directory, stdin, output limits, abort, timeout, process-tree cleanup,
and redacted diagnostics.

Prefer structured executable and argument arrays for new APIs. Keep a shell
template compatibility layer only where required. Either implement and test
correct quoting for each supported shell or fail closed with a clear
POSIX-only diagnostic on unsupported platforms; never silently apply POSIX
quoting to `cmd.exe`.

### Done when

- All external commands use the shared runner and retain their current public
  timeout/error contracts.
- Placeholder tests cover spaces, quotes, newlines, `$()`, semicolons,
  ampersands, percent expansion, and platform-specific metacharacters.
- A timeout or abort terminates the complete descendant process tree and a
  regression proves no marker process survives.
- Stdout and stderr have configurable byte limits with deterministic errors;
  MCP/CLI output never includes secret command text or substituted values.
- CI either proves Windows behavior or the affected features explicitly and
  safely reject Windows while the rest of the CLI remains usable.

## P2 — test the advertised runtime and platform contract

### Problem

Every public package advertises `node >=22.18`, an open-ended compatibility
promise. CI builds and tests only Node 22 on Ubuntu. This is especially risky
for `node:sqlite`, native Z3 Wasm workers, signals, file watching, subprocesses,
and Node's evolving TypeScript type-stripping behavior. Workflow jobs also
have no repository-specific timeout, so a stalled native/toolchain download
can consume the platform default limit.

### Direction

Define supported Node majors explicitly and test the minimum plus the current
LTS. Add a focused Windows job for package contracts whose behavior is meant
to be portable; avoid multiplying every expensive Z3 and packaging job unless
the evidence justifies it. Give all CI, deploy, and release jobs realistic
`timeout-minutes` values.

### Done when

- CI runs the source contract on Node 22.18 and the current LTS, and the
  `engines` field matches that policy.
- A Windows lane covers path handling, SQLite, the CLI lifecycle, and the
  external-process policy selected above.
- Platform-specific features are documented instead of being accidentally
  implied by a broad npm manifest.
- Every workflow job has an explicit timeout and releases remain
  non-cancellable only across the mutation window that needs that property.

## P2 — validate packed type and API contracts

### Problem

The smoke test imports every public package, checks representative exports,
and exercises the consolidated CLI. It does not compile a consumer against
the packed declaration files, validate conditional exports with standard npm
package linters, or detect accidental exported-symbol changes. With 12 public
packages and custom `publishConfig`/consolidation, a patch changeset can still
ship a declaration or API break that source-project references cannot see.

### Direction

Extend the existing tarball smoke test rather than creating a parallel
packaging path. Install the tarballs into a clean TypeScript consumer, compile
representative imports for every documented entry point under NodeNext, and
run package metadata/type-resolution validation such as `publint` and Are the
Types Wrong. Add lightweight API reports or declaration snapshots for stable
public roots; require intentional review when they change.

### Done when

- A clean consumer typechecks imports from all public roots and every
  documented `@cavelang/cli/<feature>` and store/highlight subpath.
- Package validation covers ESM resolution, types, bin files, engine metadata,
  files allowlists, and accidental private-package dependencies.
- Public API changes produce a readable diff in PRs and require a compatible
  changeset level.
- The check runs against `.tgz` contents, not workspace symlinks or source
  paths.

## P2 — exercise the production browser product

### Problem

The website CI builds the Vite bundle and the browser SQLite adapter runs its
contract under Node. No test opens the production bundle in a browser. A
broken worker/WASM URL, GitHub Pages base path, dynamic documentation route,
editor initialization, or browser-only API can therefore pass CI.

### Direction

Add one narrow browser smoke suite against `website/dist`. It should exercise
the actual shipped asset graph rather than mocking SQL.js or Tree-sitter.
Keep it focused on product-critical flows instead of screenshot-heavy UI
testing.

### Done when

- A headless browser loads the production home, documentation, and playground
  routes from the same subpath used by GitHub Pages.
- Editing sample CAVE, parsing it, loading it into SQL.js, querying it, and
  rendering syntax highlighting all succeed through bundled WASM assets.
- The test fails on console errors, uncaught rejections, failed asset requests,
  and route reload failures.
- Accessibility smoke checks cover page landmarks, labels, keyboard access,
  and visible focus for the editor controls.

## P2 — make grammar builds verifiable and network-resilient

### Problem

The grammar is the single highlighting source, but ordinary installation and
every clean CI/release build execute `tree-sitter-cli`'s postinstall download
of a platform binary. Its installer decompresses the HTTPS response directly
to an executable without checking a repository-owned digest. WASM generation
then downloads a WASI SDK. A transient or blocked GitHub release endpoint can
prevent unrelated package tests and releases.

### Direction

Choose one reproducible boundary:

- commit reviewed generated C/WASM artifacts and make regeneration an explicit
  checksum/drift job; or
- own a pinned, checksum-verified tool download/cache step and install normal
  dependencies with lifecycle scripts disabled.

Whichever path is selected, grammar source remains authoritative and CI must
prove generated artifacts match it. Do not merely add retries around an
unverified executable.

### Done when

- A normal dependency install needs no unverified executable download.
- Every executable/toolchain artifact has a pinned version and verified digest
  or is built from checked-in reviewed source.
- Source, parser, query, WASM, terminal highlighting, website, and VS Code
  extension drift is checked in one deterministic job.
- Unrelated package tests can run when the grammar regeneration network is
  unavailable.

## P3 — automate dependency and action maintenance

### Problem

Production dependencies currently have no known audit finding and workflow
actions are SHA-pinned, but the repository has no visible recurring audit or
automated npm/GitHub Actions update configuration. Pins improve reproducibility
only while someone regularly evaluates their replacements.

### Direction

Configure one low-noise weekly updater for pnpm dependencies and GitHub
Actions. Group compatible patch/minor updates, keep native/WASM and release
tooling changes isolated, and require the existing full source/artifact gates.
Run a scheduled production audit that reports actionable findings without
silently rewriting the lockfile.

### Done when

- Weekly update PRs cover npm and GitHub Actions with bounded grouping and
  concurrency.
- Native, postinstall, solver, and release dependencies receive individual
  review.
- A scheduled `pnpm audit --prod` (or equivalent advisory check) has an
  explicit severity policy and a documented exception process.
- `allowBuilds` remains deny-by-default and any new lifecycle script is
  reviewed explicitly.

## Recommended execution order

1. Fix the conditional release preflight and restore a coherent published
   version. This is the single next step and unblocks every later changeset.
2. Replace per-request sensitivity snapshots and add the missing large-history
   benchmark before permanent history grows further.
3. Centralize external-process execution, deciding the Windows contract as
   part of that work.
4. Add runtime/platform, packed-contract, browser, and grammar-toolchain gates.
5. Add low-noise maintenance automation after the gates it will rely on are
   present.

