---
name: set-based-shape-evaluation
description: Avoid one full-store query per shape pair.
status: open
priority: high
area: performance
source: measured-audit
---

# Set-based shape evaluation

## Problem

Shape evaluation performs a full-store query per instance and expectation, and gated append may evaluate twice. Runtime grows multiplicatively.

## Direction

Materialize current beliefs once per evaluation or compile satisfaction into set-based SQL.

## Done when

- Query count is bounded independently of instance × expectation count.
- Gate and check reuse the same evaluated state where safe.
- Large-shape benchmarks and semantic regression tests pass.
