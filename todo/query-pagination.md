---
name: query-pagination
description: Push limits into SQL and expose bounded iteration.
status: open
priority: high
area: query
source: architecture-review
---

# Paginate queries

## Problem

Query surfaces can materialize unbounded result sets, and client-side truncation still pays the full database and memory cost.

## Direction

Define deterministic ordering, SQL-level limits, and cursor or continuation semantics across CLI, library, and MCP surfaces.

## Done when

- Bounded requests do bounded database work.
- Pagination remains stable under documented concurrent-write conditions.
- Defaults protect interactive and MCP clients from runaway results.
