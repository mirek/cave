---
name: verb-lifecycle
description: Define in-band aliasing and deprecation for verbs.
status: open
priority: medium
area: language
source: roadmap-open-decision-4
---

# Verb lifecycle

## Problem

Renaming a verb strands historical claims because entity `ALIAS` does not apply to verbs.

## Direction

Specify a `REVERSE`-style in-band convention for verb aliasing and deprecation, then make the registry honor it consistently.

## Done when

- Rename, deprecation, history, and query semantics are explicit.
- Old and new spellings resolve predictably.
- Migration and compatibility behavior is tested.
