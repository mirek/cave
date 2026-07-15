---
name: windows-portability
description: Make test and demo commands portable to Windows.
severity: low-portability
area: tooling
source: "https://github.com/mirek/cave/pull/1"
files:
  - packages/*/package.json
  - packages/loop/src/demo.ts
---

# Test and demo commands are not Windows-portable

## Problem

Package test scripts still single-quote their glob, for example
`node --test 'test/*.test.ts'`. Windows `cmd.exe` passes those quote characters
literally. The loop demo's direct-invocation check also still splits
`process.argv[1]` only on `/`, so it misses Windows paths.

## Impact

Package tests and the loop demo can fail or silently not run on Windows.

## Direction

Use a cross-platform test discovery form and compare paths with `node:path`
and `fileURLToPath` rather than manual separator handling.
