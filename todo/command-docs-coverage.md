---
name: command-docs-coverage
description: Validate CLI and MCP reference tables against their registries.
status: open
priority: medium
area: documentation
source: implementation-audit
---

# Document command surfaces

## Problem

CLI and MCP reference coverage is now aligned, including `report`, valid-time
flags, generated action tools, hook configuration, and the effect of read-only
mode. The remaining risk is structural: command and tool tables are still
maintained separately from their registries.

## Direction

Generate or validate command/tool reference data from the actual registry,
supplemented by task-oriented examples.

## Done when

- Every shipped command and tool is listed with important options.
- Read-only and hook security behavior is explicit.
- A validation check detects registry/documentation drift.
