---
name: integration-test-gaps
description: Pin lifecycle, watcher, URL, and daemon behavior end to end.
status: open
priority: medium
area: testing
source: implementation-audit
---

# Close integration test gaps

## Problem

Watcher setup and debounce, connect URL sources, automation polling, and explicit-source lifecycle behavior lack end-to-end tests despite crossing package boundaries.

## Direction

Add deterministic integration fixtures with injected clocks, fetch, watchers, and agents instead of timing-sensitive external dependencies.

## Done when

- Startup races, retries, pruning, support retraction, and echo filtering are pinned.
- Tests clean up every process and temporary store.
- Failures identify the lifecycle stage that regressed.
