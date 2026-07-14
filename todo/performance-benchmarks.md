---
name: performance-benchmarks
description: Track representative storage and query regressions.
status: open
priority: high
area: performance
source: architecture-review
---

# Add performance benchmarks

## Problem

Large regressions in belief resolution, shape evaluation, and transitive queries are detectable only through manual profiling.

## Direction

Create deterministic fixture generators and a small benchmark suite with recorded baselines and CI-friendly regression thresholds.

## Done when

- Benchmarks cover resolution, shape checks, imports, export, and bounded/transitive queries.
- Results include store size and query plan evidence.
- CI detects material regressions without becoming flaky.
