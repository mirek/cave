---
name: zero-sigma-validation
description: Reject zero uncertainty consistently.
status: open
priority: low
area: uncertainty
source: implementation-audit
---

# Zero-sigma validation

## Problem

`(0σ)` parses, `Claim.sigmaOf` returns infinity, `Uncertainty.sigma` throws, and fusion may silently assign zero weight.

## Direction

Validate sigma once at parse/construction boundaries and use one implementation for interpretation.

## Done when

- Zero, negative, non-finite, and malformed sigma values fail clearly.
- Library constructors cannot bypass the invariant.
- Fusion and parsing share regression cases.
