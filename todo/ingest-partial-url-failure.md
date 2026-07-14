---
name: ingest-partial-url-failure
description: Isolate failed URLs from healthy ingest sources.
status: open
priority: medium
area: ingest
source: implementation-audit
---

# Partial URL ingest failure

## Problem

One non-OK URL rejects the shared `Promise.all`, aborting healthy files and URLs in the same run with a stack trace.

## Direction

Collect source-level outcomes and apply the chosen strict or lenient commit policy deliberately.

## Done when

- Every source has a reported success or failure.
- Strict mode rolls back; lenient mode preserves healthy work.
- Retryable network failures and permanent HTTP errors are distinguishable.
