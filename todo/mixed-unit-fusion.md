---
name: mixed-unit-fusion
description: Reject incompatible units at the fusion boundary.
status: open
priority: low
area: fusion
source: implementation-audit
---

# Mixed-unit fusion

## Problem

The MCP surface checks units, but the public `fuseClaims` library function can combine unrelated quantities such as currency rates and milliseconds.

## Direction

Move the invariant into the core fusion function and let adapters format the same typed failure.

## Done when

- Compatible-unit rules are explicit.
- Every caller receives the same validation behavior.
- Tests cover missing, equal, convertible, and incompatible units.
