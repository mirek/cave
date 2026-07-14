---
name: package-surface-consolidation
description: Reduce the number of independently published public artifacts.
status: open
priority: medium
area: architecture
source: architecture-review
---

# Consolidate the package surface

## Problem

Roughly twenty publishable packages multiply versioning, licensing, release, and compatibility work beyond what the public API requires.

## Direction

Classify packages as public, internal, or tooling; merge implementation-only packages or expose them as subpath exports.

## Done when

- Each published package has an independent consumer and stability promise.
- Internal boundaries remain useful inside the workspace.
- Migration guidance covers removed package names.
