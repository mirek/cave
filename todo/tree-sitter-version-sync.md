---
name: tree-sitter-version-sync
description: Keep grammar metadata in the lockstep version bump.
status: open
priority: low
area: release
source: implementation-audit
---

# Synchronize tree-sitter version

## Problem

`tree-sitter.json` carries a stale version even though it ships with a lockstep-versioned package.

## Direction

Include grammar metadata in the version bump command or derive it during packaging from the package manifest.

## Done when

- No release path can produce conflicting manifest and grammar versions.
- CI verifies all lockstep version sources.
