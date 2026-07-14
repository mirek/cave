---
name: provenance-dimensions
description: Separate actor, source, run, and domain identity.
status: open
priority: high
area: architecture
source: architecture-review
---

# Separate provenance dimensions

## Problem

Context currently carries several independent concerns: who asserted a claim, where it came from, which run owns it, and its domain scope. Lifecycle features then infer ownership from overloaded strings.

## Direction

Model provenance dimensions explicitly while preserving a compact text representation and backward-compatible reads.

## Done when

- Actor, source, run/lineage, and domain semantics are distinct.
- Lifecycle retraction does not depend on authored context strings.
- A migration preserves existing query and export behavior.
