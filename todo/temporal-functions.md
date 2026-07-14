---
name: temporal-functions
description: Design the gated temporal function layer.
status: open
priority: low
area: temporal
source: draft-spec-17.5
---

# Temporal functions

## Problem

Temporal values and trajectories exist, but the draft `(t -> expr)` function layer has no proven semantics or demand.

## Direction

Keep layer 3 gated; specify evaluation, interpolation, uncertainty, and serialization only with a concrete use case.

## Done when

- Layers 1 and 2 cannot express the motivating workflow.
- Evaluation is deterministic and bounded.
- Parser, query, storage, and display behavior agree.
