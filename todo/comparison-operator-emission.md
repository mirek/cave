---
name: comparison-operator-emission
description: Emit every comparison as valid CAVE.
status: open
priority: medium
area: canonicalization
source: implementation-audit
---

# Comparison operator emission

## Problem

`emitClaim` maps `>` to `EXCEEDS` but emits `<`, `>=`, `<=`, `=`, and `!=` as illegal symbolic verbs.

## Direction

Define a parseable canonical verb form for every comparison operator and use it at all output boundaries.

## Done when

- Every comparison round-trips through emit and parse.
- Stored fallback lines and report citations are valid CAVE.
- Compatibility of existing output consumers is documented.
