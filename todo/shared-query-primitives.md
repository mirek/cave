---
name: shared-query-primitives
description: Share current-belief, alias, and temporal SQL.
status: open
priority: medium
area: architecture
source: architecture-review
---

# Centralize query primitives

## Problem

Current-belief filtering, alias closure, reconstruction, and temporal selection are reimplemented across packages and have already drifted at edge cases such as retractions.

## Direction

Provide shared, composable SQL/query primitives with one documented semantic contract.

## Done when

- Duplicate semantic SQL is inventoried and consolidated.
- Consumers can extend queries without copying internal clauses.
- Cross-package conformance tests pin identical results.
