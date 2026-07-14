---
name: sqlite-adapter-interface
description: Replace module aliasing with an explicit SQLite adapter boundary.
status: open
priority: medium
area: architecture
source: architecture-review
---

# Define a SQLite adapter

## Problem

Build-time aliasing of `node:sqlite` couples runtime selection to bundler configuration and obscures the database capabilities packages actually require.

## Direction

Define a narrow adapter interface and inject concrete Node and browser/WASM implementations at composition boundaries.

## Done when

- Required SQL, transaction, backup, and extension capabilities are explicit.
- Runtime selection needs no source-module alias trick.
- Contract tests run against every supported adapter.
