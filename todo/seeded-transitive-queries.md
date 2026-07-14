---
name: seeded-transitive-queries
description: Constrain recursive closure from bound endpoints.
status: open
priority: high
area: performance
source: measured-audit
---

# Seeded transitive queries

## Problem

`VERB+` computes all-pairs closure before applying endpoint filters, making a fully bound query expensive on modest graphs.

## Direction

Seed recursion from a bound endpoint, as alias closure already does, and choose direction from available bindings and indexes.

## Done when

- Fully or partly bound queries avoid all-pairs closure.
- Unbound semantics remain unchanged.
- Plans and benchmarks cover chains, branches, and cycles.
