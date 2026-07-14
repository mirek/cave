---
name: async-cli-error-handling
description: Format async command failures consistently.
status: open
priority: low
area: cli
source: implementation-audit
---

# Async CLI error handling

## Problem

Bad flags in async commands such as `mcp`, `ingest`, `eval`, `serve`, and `highlight` can print raw stack traces while synchronous commands print a clean error.

## Direction

Route all handlers through one awaited top-level error boundary.

## Done when

- Expected user errors are one-line and stack-free by default.
- Debug mode can still expose diagnostics.
- Exit codes and cleanup match across command types.
