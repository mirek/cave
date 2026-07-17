---
name: dependency-action-maintenance
description: Add recurring, low-noise maintenance for package dependencies, actions, and production advisories.
priority: low
area: maintenance
source: Codex repository audit
audited-commit: a4b41b97af33e36f4d38426575102d9eb57f860f
audited-at: 2026-07-17
---

# Automate dependency and action maintenance

## Problem

The audit found no visible recurring updater for npm dependencies or GitHub
Actions and no scheduled production-advisory check. `pnpm audit --prod`
reported no known production vulnerabilities at the audited commit, but that
point-in-time result does not detect future disclosures or quietly stale action
pins.

## Direction

Add a low-noise scheduled maintenance workflow or updater configuration. Group
compatible routine updates, separate high-risk toolchain changes, and run the
same validation expected from human dependency pull requests. Schedule a
production-only advisory scan with a clear ownership and triage path.

## Done when

- npm dependencies and GitHub Actions are checked on a documented cadence.
- Routine compatible updates are grouped to limit pull-request noise.
- Native, parser, compiler, and release-tool changes remain separately
  reviewable.
- Scheduled production advisory checks fail visibly and identify an owner.
- Generated update pull requests run install, build, test, packed-artifact, and
  relevant security validation.
- The maintenance policy documents when updates may be ignored, deferred, or
  escalated.
