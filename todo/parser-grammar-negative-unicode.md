---
name: parser-grammar-negative-unicode
description: Align tree-sitter with accepted negative values and Unicode entities.
status: open
priority: medium
area: grammar
source: implementation-audit
---

# Negative and Unicode grammar

## Problem

The hand parser accepts negative numeric values and Unicode entities that tree-sitter rejects, so highlighting and the VS Code extension disagree with execution.

## Direction

Update the grammar to match the language, or explicitly narrow the specification and hand parser.

## Done when

- Both parsers agree on negative values and supported entity characters.
- Corpus fixtures cover trajectories and representative Unicode.
- Terminal and editor highlighting have no error nodes for valid input.
