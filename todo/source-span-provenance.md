---
name: source-span-provenance
description: Point source provenance at the span that produced a claim.
status: open
priority: medium
area: provenance
source: roadmap
---

# Source-span provenance

## Problem

`@src:` identifies a file or document but cannot answer which sentence or line range produced a claim.

## Direction

Specify a stable span convention such as `@src:file#L10-L20` that remains useful across ingest, reports, and reconstruction.

## Done when

- Span syntax and escaping are specified.
- Connectors can attach spans without losing the underlying source identity.
- Reports and APIs expose span links consistently.
