---
name: smoke-test-coverage
description: Cover more commands and reliable cleanup.
status: open
priority: medium
area: testing
source: implementation-audit
---

# Expand smoke coverage

## Problem

The smoke script omits several offline-testable commands and library imports, and can leak `cave serve` if a later assertion fails.

## Direction

Add representative `import`, `act`, `report`, `connect`, and MCP checks, import public libraries, and register all processes in an exit trap.

## Done when

- Major binary and library entry points run from packed installs.
- Every spawned process is cleaned up on success, failure, and signals.
- The script remains deterministic and network-independent.
