# Changesets

Every PR adds one markdown file here instead of bumping versions —
uniquely named files never conflict between concurrent PRs. Format:

```md
---
"@cavelang/core": patch
---

One-line summary of the change.
```

Name one public `@cavelang/*` package from the `fixed` group — one you
touched, or `@cavelang/core` for spec/docs-wide changes; every release bumps
the whole group together in lockstep. Private workspaces such as
`@cavelang/mcp` sit outside the group, so a changeset naming only them would
not advance the release; CI and `scripts/release-validate.mjs` reject it.

- `patch` — fixes, docs, instruction/skill wording that doesn't change
  semantics
- `minor` — new features, new CLI surface, spec/skill additions or
  semantic changes

Merged changesets accumulate in an automated `chore(release): version
packages` PR; merging that PR consumes them, bumps every version source
(`scripts/sync-versions.mjs` covers the manifests changesets doesn't
manage), publishes to npm and tags `v<version>`. See CLAUDE.md and
`.github/workflows/publish.yml`.
