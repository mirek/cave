---
name: metadata-claim-indexes
description: Index context and tag claim references.
status: open
priority: high
area: performance
source: measured-audit
---

# Metadata claim indexes

## Problem

`cave_context` and `cave_tag` lack indexes on `claim_id`, forcing correlated scans during belief resolution and export. In a 3,000-row reproduction, adding them reduced resolution from about 2.1 seconds to 51 milliseconds.

## Direction

Add the indexes through the schema migration path and verify query plans for resolution, conversion, export, temporal context, and shape scope.

## Done when

- Existing stores receive both indexes safely.
- Representative query plans use them.
- Benchmarks prevent the scan regression from returning.
