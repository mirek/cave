# Changesets

Every PR adds one markdown file here instead of bumping versions —
uniquely named files never conflict between concurrent PRs. Format:

```md
---
"@cavelang/core": patch
---

One-line summary of the change.
```

Name any one package you touched (for spec/docs-wide changes use
`@cavelang/core`); all `@cavelang/*` packages are a changesets `fixed`
group, so every release bumps them together in lockstep.

- `patch` — fixes, docs, instruction/skill wording that doesn't change
  semantics
- `minor` — new features, new CLI surface, spec/skill additions or
  semantic changes

Merged changesets accumulate in an automated `chore(release): version
packages` PR; merging that PR consumes them, bumps every version source
(`scripts/sync-versions.mjs` covers the manifests changesets doesn't
manage), publishes to npm and tags `v<version>`. See CLAUDE.md and
`.github/workflows/publish.yml`.
