---
name: unified-cli-dispatch
description: Give all CLI commands one execution and error path.
status: open
priority: medium
area: cli
source: architecture-review
---

# Unify CLI dispatch

## Problem

Synchronous and asynchronous subcommands follow different dispatch paths, producing inconsistent error formatting, cleanup, and exit behavior.

## Direction

Make command handlers uniformly promise-based and route them through one top-level lifecycle.

## Done when

- All commands share argument, error, signal, and exit handling.
- Cleanup is awaited before exit.
- CLI integration tests cover representative sync and async failures.
