---
name: documentation-source-of-truth
description: Generate or validate repeated command and API descriptions.
status: open
priority: medium
area: documentation
source: architecture-review
---

# Choose a documentation source of truth

## Problem

Versions, command tables, tool lists, and API descriptions are copied across root, package, and website docs and drift independently.

## Direction

Identify an authoritative source for each repeated fact and generate pages or validate copies during CI.

## Done when

- Ownership of command, API, version, and specification text is explicit.
- CI detects stale generated or repeated content.
- Contributor workflow remains simple and reviewable.
