---
name: sensitivity-scoped-view-performance
description: Scale sensitivity-filtered reads without rebuilding the complete visible store for each request.
priority: high
area: performance
source: Codex repository audit
audited-commit: a4b41b97af33e36f4d38426575102d9eb57f860f
audited-at: 2026-07-17
---

# Scale sensitivity-scoped views

## Problem

`packages/view/src/scope.ts` creates a new in-memory database for a scoped
read and copies every visible claim and edge into it. This preserves the
fail-closed security model, but makes request cost proportional to the whole
visible dataset rather than the query result and repeats that work for every
read.

In an audit benchmark over 5,000 rows, the default-sensitivity `topics()`
path took roughly 433 ms, compared with roughly 9 ms for a directly restricted
path. The exact numbers are environment-dependent; the order-of-magnitude gap
is the actionable evidence.

## Direction

Keep authorization at the query boundary, but replace full per-request
materialization with a representation that can reuse indexed state. Candidate
designs include sensitivity predicates compiled into queries, cached immutable
projections keyed by policy/version, or a scoped read adapter over the primary
store.

The design must remain fail-closed: missing or malformed sensitivity metadata
must never become visible through an optimization.

## Done when

- Scoped reads do not copy the entire visible graph for each request.
- Authorization semantics remain equivalent for claims, edges, references,
  malformed metadata, and default sensitivity.
- A repeatable benchmark covers representative small and large stores and
  records latency plus allocation behavior.
- The 5,000-row default-sensitivity case improves materially without regressing
  restricted reads.
- Tests prove cache invalidation or snapshot behavior when underlying data or
  sensitivity policy changes.
