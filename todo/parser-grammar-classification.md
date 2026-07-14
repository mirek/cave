---
name: parser-grammar-classification
description: Align remaining parser classification corners.
status: open
priority: low
area: grammar
source: implementation-audit
---

# Parser classification drift

## Problem

Indented all-verb two-token lines and trailing-hyphen verbs are classified differently by the hand parser and tree-sitter.

## Direction

Choose one behavior for each case and encode it in the specification and shared corpus expectations.

## Done when

- Both parsers accept and reject the same corner cases.
- Diagnostics identify incomplete claims versus continuations clearly.
- Corpus tests prevent future drift.
