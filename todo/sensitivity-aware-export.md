---
name: sensitivity-aware-export
description: Filter exports and serving by an in-band sensitivity convention.
status: open
priority: medium
area: export
source: roadmap
---

# Sensitivity-aware export

## Problem

All current claims are exportable and serveable regardless of their intended audience.

## Direction

Define a lightweight `#sensitivity:` convention and explicit filters for export and serving surfaces.

## Done when

- Sensitivity labels and defaults are specified.
- Every data-leaving surface applies the same policy.
- Tests cover unlabeled, labeled, and mixed-sensitivity stores.
