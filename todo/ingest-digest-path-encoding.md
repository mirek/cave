---
name: ingest-digest-path-encoding
description: Record digests safely for arbitrary paths and URLs.
status: open
priority: medium
area: ingest
source: implementation-audit
---

# Digest path encoding

## Problem

Digest claims are interpolated as text and parse errors are discarded, so paths or URLs containing whitespace and syntax characters are never marked processed.

## Direction

Construct provenance claims programmatically with the same escaping rules as `provenanceKey`, and surface write failures.

## Done when

- Arbitrary supported paths and URLs produce stable digest identities.
- A failed digest write fails or marks the ingest outcome.
- Tests cover spaces, delimiters, Unicode, fragments, and query strings.
