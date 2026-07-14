---
name: mcp-source-prefix-normalization
description: Prevent nested source prefixes in MCP provenance.
status: open
priority: low
area: mcp
source: bugs-mcp-src-prefix
---

# MCP source-prefix normalization

## Problem

Running `cave mcp --src src:foo` records `@src:src:foo`.

## Direction

Accept one documented input form or normalize exactly one optional `src:` prefix at the CLI boundary.

## Done when

- Help text states the accepted form.
- Equivalent inputs cannot produce different source identities.
- Tests cover prefixed, unprefixed, empty, and invalid values.
