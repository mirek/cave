---
name: cave-doctor
description: Diagnose local runtime and installation problems.
status: open
priority: medium
area: developer-experience
source: architecture-review
---

# Add `cave doctor`

## Problem

Failures can originate in Node or pnpm versions, SQLite capabilities, database state, hooks, grammar assets, extensions, or package layout, with no single diagnostic surface.

## Direction

Add a read-only command that reports capabilities, configuration sources, store health, and actionable remediation.

## Done when

- Output is safe to share and never prints secrets.
- Machine-readable and human-readable modes exist.
- Common install and runtime failures have targeted checks.
