---
name: changesets-v3-migration
description: Migrate the release automation to @changesets/cli 3 and changesets/action 2 as one deliberate change.
priority: medium
area: release
source: dependabot #187 and #189 (closed 2026-08-29)
audited-commit: 7c1950a2d8372607733acce72f50ed145021a327
audited-at: 2026-08-29
---

# Migrate release automation to Changesets v3

## Problem

Dependabot proposed `@changesets/cli` 2.31.1 → 3.0.1 (#189) and
`changesets/action` 1.9.0 → 2.1.1 (#187) as independent routine bumps. They
are not independent and they are not routine: `changesets/action@2` validates
that the project already uses Changesets CLI v3 and directs v2 users back to
`changesets/action@1`, so the two majors have to land together, and each
changes behaviour that the release flow in `.github/workflows/publish.yml`,
`package.json` (`version-packages`), `scripts/sync-versions.mjs`, and
`scripts/release-validate.mjs` relies on. Both PRs were closed and
`.github/dependabot.yml` now ignores these majors so the proposals stop
reappearing until this work is done on purpose.

## Breaking changes to absorb

`@changesets/cli` 3.0.0:

- `changeset tag` is renamed `changeset git-tag`.
- `changeset version` exits with code 1 when there are no unreleased
  changesets (previously a silent no-op); the `version-packages` script and
  the version-PR mode of `release-validate.mjs` must tolerate or avoid that.
- Private packages are no longer versioned by default. The repo relies on
  `privatePackages.version: true` in `.changeset/config.json` to move the
  private root manifest; confirm the option still has that meaning under v3
  and that `@cavelang/website` (ignored) keeps its version.
- The package is published as ESM only, with `engines` limited to
  `^22.11 || ^24 || >=26` and pnpm ≥ 10 — compatible with the supported
  runtimes, but any script importing the CLI programmatically must use ESM.
- `prettier` config option removed in favour of `format`; the repo config
  does not set either, so only the `$schema` URL needs to move to the v3
  `@changesets/config` schema.
- Peer-dependency updates now bump dependents by `patch` instead of `major`.

`changesets/action` 2.0.0:

- Root inputs renamed: `version` → `version-script`, `publish` →
  `publish-script`, `commit` → `commit-message`, `title` → `pr-title`,
  `branch` → `pr-base-branch`; `createGithubReleases` becomes the kebab-case
  `create-github-releases`, and the new `push-git-tags` defaults to creating
  tags even when GitHub releases are disabled — the repo's own
  `ensure_tag` logic in `scripts/release-publish.sh` must not double-tag.
- Release commits and tags are pushed through the GitHub API by default
  (`push-with-git-cli: true` restores the Git CLI); custom tokens go through
  the `github-token` input, not the `GITHUB_TOKEN` environment variable.
- Published-package detection moves from stdout parsing to the shared output
  file selected by the `CHANGESETS_OUTPUT` environment variable, which custom
  `publish-script` commands must forward to every CLI invocation.
- `.npmrc` handling for `NPM_TOKEN` is removed; the repo already publishes
  through npm trusted publishing, so this only needs confirming.

## Completion criteria

- `@changesets/cli` 3.x and `changesets/action` 2.x are pinned together, the
  `publish.yml` inputs are renamed, and `release-validate.mjs` still enforces
  the fixed-group and derived-manifest coherence checks in both modes.
- A version PR is produced and merged through the migrated workflow, npm and
  the VS Code Marketplace publish once, and exactly one `v<version>` tag
  exists for that release.
- The `@changesets/cli` and `changesets/action` major ignores are removed from
  `.github/dependabot.yml`, and `CLAUDE.md`'s versioning section is re-read
  for wording that names v2-only commands.
