---
name: release-coherence
description: Restore one authoritative release identity across packages, manifests, tags, and automation.
priority: critical
area: release
source: Codex repository audit
audited-commit: a4b41b97af33e36f4d38426575102d9eb57f860f
audited-at: 2026-07-17
---

# Restore release coherence

## Problem

The repository cannot currently create the version-packages pull request needed
to converge its own release state. The release preflight enforces fixed-group
lockstep before the workflow can recognize pending changesets and open that PR,
so a newly introduced or unpublished package can deadlock the recovery path.

At the audited commit:

- `node scripts/release-validate.mjs --if-release-ready` fails because
  `@cavelang/solver-z3` is `0.28.0` while the repository release identity is
  `0.28.1`.
- 67 changesets are pending, with no open version-packages pull request.
- npm reports `@cavelang/core` at `0.28.1`, most existing public packages at
  `0.27.14`, and `@cavelang/scenario` plus `@cavelang/solver-z3`
  unpublished.

## Direction

Separate release validation into two explicit modes:

1. Version-PR readiness permits changesets to repair expected manifest drift,
   while still checking that configuration, package membership, and changeset
   structure are valid.
2. Publish readiness requires exact version, dependency-range, tag, and
   fixed-group coherence.

Add a CI invariant proving that pending changesets always have a viable route to
a version PR. Bootstrap the current split state deliberately, then verify the
resulting release commit and tags.

## Done when

- The release workflow can open a version-packages PR from the audited pending
  changesets without bypassing validation.
- The version PR updates every fixed-group member and internal dependency range
  consistently.
- Publish validation fails on any remaining package, manifest, changelog, or tag
  mismatch.
- All intended public packages have the same release identity after publish,
  including `scenario` and `solver-z3`.
- CI contains a regression test for the new-package and pending-changeset
  recovery path.
- The release procedure documents which validation mode runs at each stage.
