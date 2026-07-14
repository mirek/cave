---
name: edge-case-test-gaps
description: Cover parser, protocol, escaping, time, alias, and unit boundaries.
status: open
priority: low
area: testing
source: implementation-audit
---

# Close edge-case test gaps

## Problem

Important boundaries lack fixtures: emitted comparison round-trips, grammar qualifiers and negative values, compact confidence syntax, MCP malformed input, HTML escaping, FTS quotes, zoneless time, disagreement attribution, and mixed units.

## Direction

Turn each boundary into the smallest test at the lowest stable layer, adding integration coverage only where composition is the risk.

## Done when

- Every listed boundary has an explicit expected outcome.
- Security-sensitive escaping tests use hostile stored text.
- Parser and protocol fixtures are shared across implementations where possible.
