---
name: temporal-docs-coverage
description: Cover temporal features across package READMEs.
status: completed
priority: medium
area: documentation
source: implementation-audit
---

# Document temporal features

## Problem

Query, core, CLI, MCP, and view READMEs omit parts of `--at`, trajectories, temporal APIs, or composition rules shipped in 0.24.0.

## Direction

Add one canonical temporal overview and focused package-level examples that link back to it.

## Done when

- Every public temporal option and API is discoverable.
- Examples cover as-of versus valid-time semantics.
- Documentation snippets are tested where practical.

## Outcome

The root guide remains the narrative temporal overview. Core, query, CLI,
MCP, and view READMEs now expose their `Time`, `{ at }`, `--at`, MCP `at`, and
report `at` surfaces, including trajectory interpolation and the independent
composition of valid time with transaction-time `asOf`.
