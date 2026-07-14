---
name: claim-reification
description: Add nested claims only when justified by a concrete use case.
status: open
priority: low
area: language
source: draft-spec-17.2
---

# Claim reification

## Problem

The `[S V O]` draft would make claims addressable as values, but adds substantial grammar, identity, and provenance complexity.

## Direction

Keep reification gated until a real workflow demonstrates that existing provenance and context mechanisms are insufficient.

## Done when

- Identity and equality semantics are specified.
- Nested parsing, canonicalization, storage, and querying are covered.
- The motivating workflow is simpler than available alternatives.
