---
name: alias-disagreement-attribution
description: Require a cross-name pair for alias disagreement.
status: open
priority: low
area: shape
source: implementation-audit
---

# Alias disagreement attribution

## Problem

An actor fork within one name can be reported as a cross-name alias disagreement even when no differing claim comes from another aliased name.

## Direction

Require at least one differing pair whose originating entity names differ, matching the specification's definition.

## Done when

- Intra-name forks and cross-name disagreements are distinguished.
- Reports preserve useful actor attribution.
- Minimal and multi-alias cases are tested.
