---
name: typed-client-generation
description: Generate typed query helpers from in-band schema claims.
status: open
priority: low
area: developer-experience
source: roadmap
---

# Typed client generation

## Problem

Consumers manually translate in-band shape expectations into application types and query helpers.

## Direction

Generate TypeScript types and helpers from the store's schema claims while keeping the text and query interfaces primary.

## Done when

- Generation is deterministic and versioned.
- Unsupported or ambiguous expectations fail clearly.
- Generated clients are tested against schema changes.
