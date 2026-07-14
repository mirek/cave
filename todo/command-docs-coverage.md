---
name: command-docs-coverage
description: Document missing CLI and MCP surfaces.
status: open
priority: medium
area: documentation
source: implementation-audit
---

# Document command surfaces

## Problem

CLI docs omit `report`; MCP docs omit generated action tools, hook configuration, and the effect of read-only mode.

## Direction

Generate command/tool reference data from the actual registry where possible, supplemented by task-oriented examples.

## Done when

- Every shipped command and tool is listed with important options.
- Read-only and hook security behavior is explicit.
- A validation check detects registry/documentation drift.
