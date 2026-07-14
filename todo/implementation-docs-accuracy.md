---
name: implementation-docs-accuracy
description: Correct build, dependency, and comparison documentation.
status: open
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
