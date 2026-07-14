---
name: lifecycle-source-stamp-bypass
description: Prevent authored src contexts from escaping lifecycle ownership.
status: open
priority: high
area: provenance
source: bugs-src-stamp-bypass
---

# Lifecycle source-stamp bypass

## Problem

An authored `src:` context can bypass engine stamping in connect, rules, actions, and automation, defeating prune, support retraction, or echo suppression.

## Direction

Choose one systemic rule: reject authored lifecycle contexts, force the engine stamp, or track engine ownership through explicit lineage.

## Done when

- Connect, derive, act, and automate apply the same ownership model.
- User provenance remains representable without overriding lifecycle metadata.
- Regression tests cover prune, retraction, and automation echo behavior.
