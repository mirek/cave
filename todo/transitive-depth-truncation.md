---
name: transitive-depth-truncation
description: Remove or expose the silent transitive closure limit.
status: open
priority: high
area: query
source: architecture-review
---

# Transitive depth truncation

## Problem

Transitive queries silently stop after 32 hops: a reproduced chain resolves through hop 32 but not hop 33, returning a false negative with no warning.

## Direction

Prefer cycle-safe recursion without an arbitrary semantic cap; if a resource limit remains, make truncation explicit in the result.

## Done when

- Results beyond 32 hops are correct or explicitly incomplete.
- Cycles terminate and resource controls are documented.
- Boundary, cycle, and large-graph tests are included.
