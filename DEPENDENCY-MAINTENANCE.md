# Dependency maintenance

Repository owner `@mirek` owns dependency and GitHub Actions triage. Automated
updates never merge without the same green checks and review expected of a
human dependency pull request.

## Cadence and grouping

Dependabot checks the pnpm workspace every Monday at 05:00 Europe/Paris and
GitHub Actions every Thursday at the same time. Compatible minor and patch
updates are grouped to keep review noise low. Major updates remain individual.

Native and WebAssembly runtimes, parsers, compilers/build tools, browser test
infrastructure, and release/publishing tools are excluded from the routine
groups. Each update to those dependencies or foundational actions gets its own
pull request so generated artifacts, platform behavior, and release authority
can be reviewed independently. Action updates must remain pinned to a complete
commit SHA with a readable version comment; do not replace pins with tags.
The report's `mdast-util-*` and `micromark*` dependencies are included in these
parser exclusions: their syntax boundaries determine which template constructs
execute queries. Review their updates against the report's literal-region,
code-span and query-fence tests as well as the packed CLI checks.

Every update pull request runs the repository's ordinary CI: frozen install,
clean and incremental builds, full tests, browser and platform coverage, and
packed npm/VSIX smoke tests. Dependency or workflow changes also run the
dependency advisory workflow, including development tooling.

Run supported Node-major full suites sequentially when they share one local
home directory. A concurrent review run observed Tree-sitter fail with a missing
`~/.cache/tree-sitter/lock/cave-…lock` file while the other major continued;
the same grammar passed after that run finished. Treat shared native caches as
part of local test isolation. Preserve the failed log and rerun the affected
suite separately instead of treating a partial run as a passing matrix result.
This observation does not establish a defect in grammar parsing or require
serializing CI jobs that already have separate runners and caches.

## Changesets release toolchain

CLI 3.0.2 and action 2.1.1 are a coupled migration: action v2 requires CLI v3.
The local checkout implements that pairing. The 3.0.2 patch updates the
prerelease-exit review message and internal dependencies; its
[upstream changelog](https://raw.githubusercontent.com/changesets/changesets/main/packages/cli/CHANGELOG.md)
describes the changes. The patch retains the same supported engine ranges.
Earlier migration rehearsals used 3.0.1 and retain their historical scope. The original independent
Dependabot proposals (#187 and #189) were closed while compatibility was
reviewed; their temporary major ignores have now been removed.

The action is pinned to `8488615a623b1b9c987934bb89eae8af6a946ac1`.
Its [input definitions](https://github.com/changesets/action/blob/8488615a623b1b9c987934bb89eae8af6a946ac1/action.yml)
use `version-script`, `publish-script`, `commit-message`, `pr-title` and
`create-github-releases`. Keep both `create-github-releases` and `push-git-tags`
false: CAVE's release script owns its single `v<version>` tag. The default token
input supplies the workflow token; custom tokens belong in `github-token`.
Version commits use the action's GitHub API path by default.

The [publish implementation](https://github.com/changesets/action/blob/8488615a623b1b9c987934bb89eae8af6a946ac1/src/run.ts)
reads newline-delimited objects from `CHANGESETS_OUTPUT` with `type: "git-tag"`,
string `tag`, and string `packageName`, then resolves names against workspace
versions. No events means `published: false`; missing output warns and falls
back to no events. CAVE publishes through pnpm, so forwarding the environment
variable alone is insufficient. `scripts/release-output.mjs` reports verified
publications after registry and tag checks and creates empty output for a fully
published recovery. See [release behavior](IMPLEMENTATION.md#toolchain) for
failure ordering, version synchronization, and local fixture coverage.

When reviewing future updates, retain these CLI v3 boundaries:

- The tag command is `changeset git-tag`; CAVE's publisher owns tagging itself.
- An empty `changeset version` exits 1. CAVE intentionally stops at that failure;
  its action routes only pending changesets to the version script.
- `privatePackages.version: true` versions private workspace packages, not the
  root manifest. The synchronizer aligns the root and remaining release sources;
  the ignored website stays unchanged. Every advanced workspace needs a
  changelog entry for the action's PR summary.
- CLI v3 is ESM-only and requires Node `^22.11 || ^24 || >=26` and pnpm 10 or
  newer. CAVE's supported runtime and package-manager pins satisfy those ranges.
- Configuration uses `format` in place of the removed `prettier` option. CAVE
  sets neither and selects the `@changesets/config@4.0.0` schema.
- Peer-dependency updates bump dependents by patch rather than major.
- Action v2 does not configure `.npmrc` from `NPM_TOKEN`; CAVE uses npm trusted
  publishing through the existing workflow identity.

A local source-level integration trial also imported `runPublish` from that
exact action commit and executed CAVE's `release-output.mjs` in temporary pnpm
workspaces. Full and partial output produced the expected package names and
versions; an empty recovery returned `published: false`; a failing script
retained exit code 1 and the expected missing-output warning. GitHub API access,
network fetches during execution, and tag pushes were guarded to fail the trial
if attempted. The action's source dependencies were installed temporarily with
lifecycle scripts disabled, and the entire workspace was removed afterward.

A second trial imported the pinned `runVersion` source and ran the installed
CLI's version command followed by CAVE's synchronizer against copied workspace
manifests and changelogs. Local doubles captured branch preparation, change
pushing and PR creation. The generated summary contained the public core,
private act/automate packages and extension at the fixture version, retained
the generated alignment notes, and excluded the unchanged website. Its branch
and PR/commit titles matched CAVE's workflow. The temporary Git repository had
no remote, and the source/workspace installation was removed after the check.
This trial covered versioning and synchronization, not grammar regeneration
or the lockfile-refresh stage of the full version script.

These trials verify the source-level publication and version-summary paths.
Hosted evidence now also covers the bundled entrypoint and external publication.

### Hosted migration verification

The CLI 3.0.2/action 2.1.1 workflow generated [release PR #223](https://github.com/mirek/cave/pull/223),
consuming 2,033 changesets and aligning 24 package/extension manifests at 0.36.0.
The PR passed CI and Codex review before merging at
`b09cbf06d10f7dd1be8abedc29f3336208d4cc61` on September 12, 2026.
[Publish run 34695314713, attempt 1](https://github.com/mirek/cave/actions/runs/34695314713/attempts/1)
passed preflight, published all 12 public npm packages at 0.36.0, pushed the
single `v0.36.0` tag at that commit, and published the VS Code extension.
The independent `pnpm release:audit` installed the declared package set with
lifecycle scripts disabled and verified 86 registry signatures and 27 available
attestations. This verifies registry provenance, not byte equality with a local
rebuild. See [release behavior](IMPLEMENTATION.md#toolchain) for the operational
contract and retry procedure.

[Attempt 2 of the same run](https://github.com/mirek/cave/actions/runs/34695314713/attempts/2)
then verified fully published recovery at the same commit. After a clean build,
tests and packed smoke checks, it reported `v0.36.0 is fully published` and
`tag v0.36.0 already exists on origin`, with no new npm publications. The
Marketplace job also skipped its already-published version. All three jobs
passed and the remote tag still pointed to the original release commit.

## Dependency advisories

`.github/workflows/dependency-advisories.yml` runs `pnpm audit --audit-level=low`
every weekday and on dependency or workflow pull requests. It includes both
production dependencies and development tooling, including the VSIX packager
and publishing clients. A production-only audit can be useful for triage but
does not replace the full audit gate.
Healthy scheduled runs create no issue or pull request. A finding or registry
failure makes the workflow visibly fail, names `@mirek`, and links back to this
policy in the job summary.

For each finding, record whether the affected path is shipped or used by tooling,
whether the vulnerable operation is reachable in that context,
whether a fixed version exists, and the intended remediation:

1. Patch reachable critical or high advisories immediately. If public
   discussion would expose users before a fix exists, use a private GitHub
   security advisory until coordinated disclosure is safe.
2. Patch other reachable advisories in the next maintenance pull request.
3. Defer only when the fixed version is incompatible or the affected path is
   unreachable. Open a tracking issue that names the owner, evidence, and a
   review date no more than 30 days away.
4. Ignore only a confirmed false positive or an affected path proven unreachable
   in its production or tooling context.
   Add the GHSA to `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` with a
   tracking issue and expiry comment. Never ignore a registry failure.

Close or defer an automated version update when it breaks the supported
runtime/platform contract, introduces a regression, or needs coordinated
migration work. Link a tracking issue and review date. Escalate immediately
when an action pin is revoked or compromised, a release credential boundary
changes, or an advisory reachable in production or tooling has no safe upgrade; disable the
affected workflow or feature until the risk is contained.

## Vite build and development-server checks

The website uses Vite 8.3.0. Its Node requirement (`^20.19.0 || >=22.12.0`)
covers CAVE's supported Node majors. The [versioned changelog](https://raw.githubusercontent.com/vitejs/vite/v8.3.0/packages/vite/CHANGELOG.md)
includes worker URL, asset URL and preload changes. Keep production verification
under the `/cave/` subpath with worker/WASM loading and lazy-route recovery;
a successful root-page build alone does not cover those asset paths.

Vite is pinned exactly to 8.3.0 and patched through
`patches/vite@8.3.0.patch`. When closing the development dependency optimizer,
the patch settles both current and queued dependency-processing promises after
cancelling optimization. Without this cleanup, client transforms can continue
waiting for those promises after the optimizer has closed, preventing
`server.close()` from completing. The same timeout was also observed with
8.2.2; it was not established as an 8.3-specific regression.
The patch also prevents `ensureWatchedFile` from adding files to a closed
watcher. Chokidar's `add` reopens its instance: a late transform or shutdown
hook can otherwise create a native watcher after Vite has already awaited
watcher cleanup. The deterministic shutdown-hook regression fails without
this guard and passes with it on both supported Node majors.

`website/test/vite-close.test.ts` runs `scripts/vite-close-probe.mjs` with an
isolated empty optimizer cache. It requests the entry point, documentation,
playground and worker transforms, then requires successful process termination.
It also runs a shutdown hook that adds an external watched file and asserts
that the watcher remains closed. The combined patch passes full workspace
integration on Node 24.21.0 and 26.8.1 (3,185 tests each), all 144 production
browser tests, and normal development CLI termination after five route/worker
requests. Thirty repeated uninstrumented cold-cache Node 26 probes exit
naturally. These checks supersede the optimizer-only patch's intermittent
integration failure.

The probe reports `closed: true` only after awaiting close and checking the
watcher; successful process termination is still required. A parent timeout
kills a hung diagnostic process and counts as failure. The optional Vite
entrypoint and `CAVE_VITE_CACHE_DIR` support isolated comparisons;
`CAVE_VITE_LATE_WATCH=1` enables the shutdown-hook regression.

Retain or adapt the patch on future Vite updates until the replacement passes
the cold-cache shutdown regression on both majors, normal CLI termination and
the full production-browser suite. Use pnpm patch/patch-commit so the patch,
workspace configuration and lockfile stay aligned. This development-tooling
fix does not change the playground's database cleanup protocol or impose a
general runtime deadline.

## Website React updates

The website uses React and React DOM 19.3.0 with their matching 19.3 declaration
packages. Review these four dependencies together: React DOM 19.3 requires
React `^19.3.0`, and its declarations require `@types/react: ^19.3.0`.
The [upstream changelog](https://raw.githubusercontent.com/facebook/react/main/CHANGELOG.md)
includes lazy-initializer and Suspense fixes as well as new optional APIs.
CAVE's documentation and playground routes use lazy loading inside Suspense,
so production tests must exercise delayed and failed route downloads, recovery,
navigation history and focus restoration alongside ordinary page rendering.

A successful TypeScript build or Node-based website test alone does not verify
the renderer update. Run the full browser suite against the rebuilt production
site, including workers/WASM, mobile layouts, filtering, editing, printing and
copy fallbacks. Dependency adoption does not by itself enable View Transitions,
Fragment refs or other new APIs; changing those interactions requires a separate
implementation and accessibility review.

## Node and Emscripten declaration patches

The root uses `@types/node` 22.20.2 and the highlighter directly depends on
`@types/emscripten` 1.41.6. The existing SQL.js declaration dependency retains
its separately locked older Node/Emscripten declarations.
Reviewing integrity-checked old/new registry tarballs showed that the Node
patch adds the global `ReadableWritablePair` alias used by Web Streams. The
Emscripten patch exposes filesystem name-table helpers and corrects `FSNode`
parent/device types: the parent may be null, the device is optional, and `rdev`
can be undefined. It also raises the declaration package's TypeScript minimum
from 5.2 to 5.6; CAVE's 5.9.3 compiler satisfies that minimum.

These are declaration updates, with no JavaScript or WASM runtime replacement.
The Emscripten types are a public highlighter dependency, so installed-consumer
NodeNext/Bundler checks and the public API snapshot matter alongside workspace
and extension compilation. Keep the established Node declaration major and the
separate exact VS Code baseline; these patches do not raise CAVE's supported
Node or editor minimums.

## Playwright browser-test updates

The website uses `@playwright/test` 1.63.0, with matching `playwright` and
`playwright-core` packages in the lockfile. The package requires Node 20 or
newer, covering both supported CAVE majors. The
[versioned release notes](https://github.com/microsoft/playwright/releases/tag/v1.63.0)
remove Ubuntu 20.04 support; the browser CI job already uses Ubuntu 24.04.
This release's Chromium build is 153.0.8010.12 (revision 1243). Install the
browser matching the lockfile through `pnpm --dir website exec playwright
install --no-shell chromium`; a previously installed browser is not version evidence.
For local review, `--no-remove` preserves other Playwright installations' browsers.

The suite selects `channel: 'chromium'`, using the full browser's headless mode.
[Playwright documents this mode](https://playwright.dev/docs/browsers#chromium-new-headless-mode)
as sharing normal browser behavior more closely than the separate headless shell.
CI installs that browser with `--no-shell`. This follows intermittent hosted
middle-click failures in both documentation navigation and article section links,
where the click completed but no new page event arrived. The symptom also appears
in [upstream issue #42142](https://github.com/microsoft/playwright/issues/42142),
including a plain-HTML reproduction; a passing local run did not rule it out.
The mode change retains native clicks, destination assertions, failure traces,
and the input timeline. It does not add retries or replace the click with a
programmatic page opening. Future browser updates must still pass the full suite.

The existing single-worker Chromium suite needs no migration to the new test
locks, frame locators or trace snapshot APIs. All 144 production-browser tests
pass with 1.63.0 on Node 26.8.1, and all 147 website unit tests pass on Node
24.21.0 and 26.8.1. Full workspace integration also passes on each major:
3,185 tests and all 38 grammar parses, with no failures or skips. Clean and
incremental builds, all 12 installed public-package smoke checks and VSIX
validation pass with this dependency set. Earlier checkpoints retain their
original scope. The browser suite does not
establish Firefox, WebKit or hosted Linux behavior.

## Registry checkpoint — 2026-09-12

The full `pnpm audit --audit-level=low --json` check reports zero advisories
across 529 dependencies, including development tooling. Recursive outdated
inspection finds only TypeScript 5.9.3 → 7.0.2 and VS Code types 1.100.0 →
1.137.0; both installed versions equal their requested versions. The compiler
API migration and editor-baseline policies below explain those holds. Current
source still uses the legacy TypeScript APIs and compiler entrypoint, and the
extension still declares VS Code 1.100.0 as its minimum. No dependency update
or audit exclusion was added. This is a registry snapshot, not a guarantee
against unreported vulnerabilities or future advisories.

## Compiler and highlighting runtime upgrades

TypeScript is both the workspace compiler and a library used by CAVE's package
checks. Keep the current 5.x range until a deliberate migration covers all of:

- `scripts/packed-contract.mjs`: program creation, diagnostics, AST traversal
  and declaration printing for installed NodeNext/Bundler consumers.
- `scripts/packed-api-render.mjs`: symbol resolution, type rendering and the
  complete public API snapshot.
- `scripts/check-runtime-dependencies.mjs`: JavaScript AST parsing and traversal
  to find undeclared runtime dependencies in published modules.
- `packages/mcp/test/release-validate.test.ts`: the fixture resolves
  `typescript/lib/tsc.js`; compiler entrypoint handling must migrate too.

A 2026-09-11 isolated probe of the integrity-checked TypeScript 7.0.2 tarball
confirms its root export contains only version information. `createProgram`,
`createSourceFile` and `createPrinter` are absent. The copied runtime dependency
checker fails before inspecting a fixture import, and resolving the existing
compiler path throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, on both supported Node
majors. These are concrete blockers to a direct version replacement.
Microsoft's [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
describes a side-by-side legacy API/compiler arrangement. That is a migration
option, not CAVE's current setup: it requires explicit compiler routing and
verification of both clean/incremental builds and every package gate above.
The new unstable API exports do not preserve the existing root API contract.

`web-tree-sitter` is shared by the terminal highlighter, website and VS Code
extension. Review upgrades across all three consumers and keep each JavaScript
wrapper paired with its own runtime WASM. The grammar generator remains pinned
separately in `scripts/grammar-toolchain.json`; a runtime update must demonstrate
that it loads the shipped grammar rather than assume matching version numbers
are necessary or sufficient. In an isolated 0.27.0 runtime trial, all 22 current
highlighter tests pass on both supported Node majors with CAVE's unchanged
grammar WASM. The workspace now uses 0.27.0 across all three consumers. This
update retains the existing generated grammar and separately verifies compiler,
browser, editor and installed-package behavior; the isolated trial alone does
not establish those contracts. The system-review ledger records the completed
checks and any remaining verification for this update.

## VS Code API baseline

The extension declares `engines.vscode: ^1.100.0` and pins `@types/vscode`
exactly to 1.100.0. The former `^1.100.0` type range had resolved to 1.125.0:
compilation could accept editor APIs newer than the declared minimum. The
installed VSCE validator compares the manifest's declared type range with the
engine, not the resolved declarations, so a successful package build did not
exclude this drift. The exact pin restores the intended compile-time baseline.

Keep the existing Dependabot minor/major exclusion for `@types/vscode` and
review the type pin and editor minimum together. A newer declaration package
is not automatically a compatible maintenance update even when its semver
major is unchanged. VS Code's [compatibility guidance](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#visual-studio-code-compatibility)
requires the engine minimum to cover the APIs used. Typechecking against that
minimum complements the real extension-host test; it does not prove host behavior.

## Packaging-tool dependencies

Production-only audits exclude the VS Code packaging tool's development
dependency tree. The scheduled full audit includes it. Run
`pnpm audit --audit-level=low` when reviewing packaging dependencies, then
exercise the real VSIX packaging command on both
supported Node majors. A clean production audit does not establish that the
packaging or publishing environment has no reported advisories.

The 2026-09-08 full audit identified 16 advisories in five transitive packages
under `editors/vscode > @vscode/vsce`. The lockfile update retained all declared
dependency ranges and selected these compatible patched resolutions:

- `fast-uri` 3.1.3 → 3.1.7, through AJV in Secretlint configuration/formatting.
- `brace-expansion` 5.0.7 → 5.0.9, through minimatch in packaging file selection.
- `js-yaml` 4.3.0 → 4.3.2, through Secretlint configuration/formatting.
- `qs` 6.15.3 → 6.16.0, through the Azure DevOps REST client.
- `undici` 7.28.0 → 7.29.1, through Cheerio.

These are tooling paths; the VSIX allowlist excludes their `node_modules`
contents. Reachability of each advisory's specific exploit conditions was not
established, and no suppression or deferral was needed: compatible updates
removed all 16 reported findings. Both full and production audits returned zero
advisories after the update. This is dated registry evidence, not a permanent
guarantee or proof that the publishing environment is risk-free.

A fresh full `pnpm audit --json` on 2026-09-11 returned zero advisories at every
severity, including development tooling. Registry metadata reported 141 runtime,
388 development, 96 optional and 529 total dependencies; these categories overlap
and must not be added together. The check follows the Playwright 1.63.0 update and required no advisory
suppressions. It refreshes the registry evidence without proving
the absence of undisclosed vulnerabilities or verifying a hosted release.

## SQL.js text compatibility patch

`website/package.json` pins SQL.js to 1.14.2 and `pnpm-workspace.yaml` applies
`patches/sql.js@1.14.2.patch` to its optimized `sql-wasm.js` and
`sql-wasm-browser.js` bundles. The patch replaces NUL-terminated text binding
with an explicit UTF-8 byte count and replaces text retrieval with full-byte
UTF-8 decoding. `TextDecoder` uses `ignoreBOM: true` to preserve an authored
leading BOM. Other result types keep their existing decoding. The patch does
not claim to repair every alternate SQL.js build or its user-defined-function
API; CAVE uses prepared statements through these two bundles.

A SQL.js update must either retain an adapted patch or establish that upstream
preserves these bytes. Validate the website runtime tests (binding hex bytes,
get/all text and mixed result types) and production browser tests (rebuild and
query a NUL-containing claim name). Remove the pin and patch only after the
replacement passes both paths. Do not strip NULs or change claim identities as
a workaround. Use pnpm patch/patch-commit to update the tracked patch and
lockfile together; frozen installs must apply it successfully.

Clean-install verification copies the workspace manifests, lockfile, workspace
configuration and patch into an isolated directory, installs the website's
production dependencies with `--frozen-lockfile --ignore-scripts` and a fresh
`--store-dir`, then initializes both optimized bundles with the installed WASM
binary. Check bound text and its SQL `hex(?)` bytes for embedded NULs, Unicode,
a leading BOM and empty text. This isolates patch application from an already
modified `node_modules` tree. Remove the scratch installation afterward.
The system-review clean run downloaded 111 packages with zero reuse and passed
both bundles; it did not stand in for the separate full-workspace or browser
suites.
