---
name: alias-typo-blocking
description: Let leading-character typos reach alias scoring.
severity: low-recall
area: "@cavelang/shape"
source: "https://github.com/mirek/cave/pull/19"
files:
  - packages/shape/src/suggest.ts
---

# Alias suggestions miss leading-character typos

## Problem

Candidate blocking still requires the same first normalized character, an
exact token, or a shared rare value. High edit-similarity pairs such as
`postgres` and `ostgres` never reach scoring.

## Impact

The advertised typo signal silently misses a common typo class.

## Direction

Add an edit-tolerant block such as suffix, trigram, or length buckets before
scoring.
