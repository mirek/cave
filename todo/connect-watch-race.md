---
name: connect-watch-race
description: Attach watchers before initial work and retain all events.
status: open
priority: low
area: connect
source: implementation-audit
---

# Connect watch race

## Problem

`connect --watch` attaches after the initial pass, so edits during slow startup are missed, and it drops events whose watcher reports no filename.

## Direction

Establish the watch boundary first, reconcile after the initial pass, and treat filename-less events as a reason to rescan.

## Done when

- No change in the startup window is lost.
- Null-filename and burst behavior is deterministic.
- Debounce, teardown, rename, and error paths are tested.
