---
name: report-backtick-citations
description: Render backtick-containing declarations as valid Markdown.
status: open
priority: low
area: report
source: implementation-audit
---

# Report backtick citations

## Problem

Rule and action declarations may contain backticks, which break the report's single-backtick code spans and citation footnotes.

## Direction

Choose Markdown fences based on content or use a representation that escapes arbitrary declarations safely.

## Done when

- Generated Markdown parses correctly for one or more embedded backticks.
- Default bullets and footnotes use the same helper.
- Rendering tests include hostile declaration text.
