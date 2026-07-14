---
name: rules-max-passes-retraction
description: Avoid false retractions at the derivation pass limit.
status: open
priority: low
area: rules
source: implementation-audit
---

# Rules pass-limit retraction

## Problem

When derivation reaches `maxPasses`, the retraction sweep treats still-suspended valid derivations as absent and writes transient `@ 0%` history.

## Direction

Distinguish a complete fixed point from truncation and skip destructive reconciliation when completeness is unknown.

## Done when

- Pass exhaustion is visible in status and exit behavior.
- Valid deep-chain conclusions are not transiently retracted.
- Full and incremental derivation have regression coverage.
