---
name: redaction-forgetting
description: Decide how exceptional history rewriting works.
status: open
priority: high
area: storage
source: roadmap-open-decision-3
---

# Redaction and forgetting

## Problem

Retraction leaves secrets and personal data in `raw_line`, history, and exports. The project has not committed either to permanence or to a safe forgetting operation.

## Direction

Choose and document permanence, or specify an exceptional `cave redact` operation that rewrites history while leaving a non-sensitive tombstone.

## Done when

- The security and audit trade-off is documented.
- Storage, backup, sync, and export behavior agree.
- Destructive behavior requires explicit confirmation and has recovery guidance.
