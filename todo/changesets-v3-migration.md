---
name: changesets-v3-migration
description: Verify the locally migrated Changesets CLI v3 and action v2 through the hosted release workflow.
priority: medium
area: release
source: dependabot #187 and #189 (closed 2026-08-29)
---

# Verify the migrated Changesets release workflow

The local migration pairs CLI 3.0.2 and action 2.1.1, updates workflow inputs
and the schema, removes temporary major ignores, and bridges verified pnpm
publication to action output. Installed-CLI fixtures cover workspace versioning,
private packages, derived sources, changelog alignment and the empty second
version run. Local publication fixtures cover success, partial publication,
recovery and failures. A source-level trial of the pinned action's runPublish
module also verifies full/partial output, empty recovery and failed-script exit
status using CAVE's output helper, with GitHub API access and tag pushes blocked.
The pinned runVersion source also generated a PR summary from copied CAVE
manifests after actual CLI versioning and synchronization, using local doubles
for GitHub calls. Public, private and extension entries were present; the
unchanged website was excluded. Grammar generation and lockfile refresh were
outside that source-level trial. These checks do not run the bundled action
on a hosted runner or publish.

A later isolated rehearsal used all 1,335 accumulated changesets to produce
candidate version 0.36.0. Actual CLI versioning, CAVE version synchronization,
pinned grammar generation, all 38 grammar parses, offline lockfile refresh and
frozen verification, TypeScript build, all 12 installed npm package smoke checks,
and candidate VSIX validation succeeded. The extracted 0.36.0 VSIX also passed
the real macOS editor-host test. The empty second CLI version run returned its
documented status 1 and left metadata unchanged. Evidence and scratch paths
are recorded in the [system review](system-review.md#candidate-version-vsix-passes-package-and-real-host-verification).
These local artifacts do not establish hosted release completion.

Compatibility rationale and pinned upstream references live in
[Dependency maintenance](../DEPENDENCY-MAINTENANCE.md#changesets-release-toolchain).
Version synchronization, publication ordering and recovery behavior live in
[Implementation](../IMPLEMENTATION.md#toolchain).

## Remaining verification

The latest inspected successful Publish run,
[34019969960](https://github.com/mirek/cave/actions/runs/34019969960), ran on
2026-09-06 at commit `4a5c4c7a3f1c9f7a43cbc283e40db0fd08eb0360`.
A 2026-09-11 read-only GitHub CLI check confirmed it is still the latest
Publish run, at the same commit. The same check fetched the workflow at that
exact commit and reconfirmed the v1 pin; the local worktree instead pins v2 at
`8488615a623b1b9c987934bb89eae8af6a946ac1`.
A 2026-09-12 read-only check again returned the same latest run, status and
commit. Fetching `publish.yml` at that commit reconfirmed the v1 pin, while
the local worktree still uses the v2 pin above. No newer hosted migration
evidence was available from the Publish run list.
Its preflight, release, and vscode jobs succeeded, but its release job used
`changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d` (v1),
matching the workflow at that commit. It is evidence for the prior release
workflow, not the v2 migration in this uncommitted audit worktree. The local
extension-host and dark/light theme checks likewise do not verify publication.

- Exercise the pinned v2 action with CAVE's custom version and publish scripts,
  including published-package output and fully published recovery.
- Produce and merge a version PR through the migrated workflow, then verify npm
  and VS Code Marketplace publication and exactly one `v<version>` release tag.
- Record the exact workflow run, version commit, package versions and tag used
  as evidence. Delete this task and its TODO entry after verification, retaining
  durable operational details in the live guides above.

External release operations require the session's authorization. No hosted
release of this worktree has yet been verified.
