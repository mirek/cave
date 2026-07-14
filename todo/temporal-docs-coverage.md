---
name: temporal-docs-coverage
description: Cover temporal features across package READMEs.
status: open
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
