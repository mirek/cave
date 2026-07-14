---
name: stable-external-records
description: Define a versioned public JSON and record representation.
status: open
priority: high
area: api
source: architecture-review
---

# Stabilize external records

## Problem

Several commands and packages expose database-shaped objects, making internal schema changes accidental public API changes.

## Direction

Define a canonical external claim/transaction schema, version its serialized form, and map storage rows at the boundary.

## Done when

- CLI JSON, MCP, export, and library surfaces state their compatibility contract.
- Internal-only fields are not leaked accidentally.
- Round-trip and backward-compatibility fixtures are maintained.
