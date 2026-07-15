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

## Progress

`DOCUMENTATION.md` now indexes every maintained surface, names authoritative
sources for repeated facts, provides a change-to-doc map, and defines the
every-PR freshness contract. The PR template requires authors to record that
review. The remaining work is automated validation or generation for command
and API registries beyond the website's direct Markdown imports and derived
version displays.

## Done when

- Ownership of command, API, version, and specification text is explicit.
- CI detects stale generated or repeated content.
- Contributor workflow remains simple and reviewable.
