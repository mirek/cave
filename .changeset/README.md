# Changesets

Every PR adds one markdown file here instead of bumping versions —
uniquely named files never conflict between concurrent PRs. Format:

```md
---
"@cavelang/core": patch
---

One-line summary of the change.
```

The version PR consumes existing changesets instead of adding one. CI exempts
only `changeset-release/main` from this repository targeting `main`; matching
branch names in forks and other branches with the same prefix still require
a changeset. The changeset job reports success for the recognized version PR,
and the aggregate gate requires that job to succeed on every PR.

Name one public `@cavelang/*` package from the `fixed` group — one you
touched, or `@cavelang/core` for spec/docs-wide changes; every release bumps
the whole group together in lockstep. Private workspaces such as
`@cavelang/mcp` sit outside the group, so a changeset naming only them would
not advance the release; CI and `scripts/release-validate.mjs` reject it.
For a private module bundled into the CLI, name `@cavelang/cli` in the same
changeset at the same or higher severity. The release validator derives those
modules from the CLI's published internal exports and rejects missing or weaker
CLI entries, even when another public package appears in the changeset.

On a working branch, `pnpm exec changeset status` previews the current release
plan without changing versions. This preview is not release approval: the
repository's release preflight checks committed inputs on `main` (or a reachable
detached commit), including the additional bundled-module rule.
Committed changeset discovery uses NUL-delimited Git paths, so quoted, Unicode
and multiline filenames remain part of the pending set. Preflight validates
the original file contents without trimming leading whitespace before parsing
frontmatter, using the same metadata rules as CI.
The preflight accepts exactly one argument, `--mode=version-pr` or
`--mode=publish`; extra arguments and repeated modes fail before repository
access or fetching refs.
The publisher script, invoked by `pnpm release:publish` and `make publish`, takes
no arguments and has no dry-run mode of its own. Arguments passed to the script
are rejected before preflight, including `--dry-run`.
Use `pnpm exec changeset status` for a release-plan
preview and the documented validator modes for their narrower checks.

- `patch` — fixes, docs, instruction/skill wording that doesn't change
  semantics
- `minor` — new features, new CLI surface, spec/skill additions or
  semantic changes

Merged changesets accumulate in an automated `chore(release): version
packages` PR; merging that PR consumes them, bumps every version source
(`scripts/sync-versions.mjs` covers the manifests changesets doesn't
manage), publishes to npm and tags `v<version>`. See CLAUDE.md and
`.github/workflows/publish.yml`.
## Local metadata validation

Run `node scripts/check-changesets.mjs .changeset/<slug>.md` from the repository
root to check one or more pending files. CI runs this on added changesets. It
shares syntax, summary, package-name, fixed-group and bundled-CLI severity rules
with release preflight. It also checks that the configured fixed group contains
every public package exactly once, rejecting omissions, duplicates, private
packages and unknown names before validating the selected files. Group order
does not matter. Every package manifest, including private workspaces, must
have a nonempty string name unique across the workspace. Duplicate names are
rejected before release ownership is resolved, so a private manifest cannot
shadow the public CLI and hide its bundled-module requirements. Empty frontmatter with a summary remains valid for a
documentation-only changeset. This check reads the working tree and does not
establish that a commit is ready to publish.
