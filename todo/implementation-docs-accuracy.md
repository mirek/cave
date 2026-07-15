---
name: implementation-docs-accuracy
description: Correct build, dependency, and comparison documentation.
status: completed
priority: medium
area: documentation
source: implementation-audit
---

# Correct implementation documentation

## Problem

`IMPLEMENTATION.md` describes no build step and `tsc --noEmit`, omits runtime dependencies, and overstates comparison canonicalization.

## Direction

Document run-from-source development separately from emitting build/publish behavior, enumerate runtime dependency classes, and match actual operator support.

## Done when

- The implementation guide matches manifests and scripts.
- Comparison examples round-trip.
- Repeated claims in package READMEs are updated or generated.

## Outcome

`IMPLEMENTATION.md` now separates source execution from the emitting
composite build used by CI and npm packaging, lists runtime dependencies by
feature boundary, and no longer overstates a no-build/no-dependency model.
Canonical documentation now scopes symbolic comparisons to attached
qualifier conditions and points isolated-row emission at the remaining
canonicalization backlog.
