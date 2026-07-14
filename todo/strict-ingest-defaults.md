---
name: strict-ingest-defaults
description: Fail atomically unless lenient ingestion is explicit.
status: open
priority: high
area: ingest
source: architecture-review
---

# Make ingest strict by default

## Problem

Partial parse or extraction failures can leave users unsure which claims and digests were committed.

## Direction

Make the default atomic and fail-loudly; offer a named lenient mode with a complete per-source result manifest.

## Done when

- Strict mode commits no claims or digests after any fatal input error.
- Lenient mode reports every accepted and rejected unit.
- Exit codes, retries, and paid-agent calls are documented and tested.
