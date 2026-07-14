---
name: push-listener-ingestion
description: Add demand-driven continuous ingestion for push sources.
status: open
priority: low
area: ingest
source: roadmap
---

# Push/listener ingestion

## Problem

`cave connect --watch` follows files, but sockets and webhooks require an external bridge.

## Direction

Wait for a concrete source, then define the smallest listener boundary that preserves deterministic conversion and local operation.

## Done when

- A real use case establishes transport and delivery requirements.
- Retry, authentication, deduplication, and shutdown behavior are explicit.
- The core remains usable without a resident service.
