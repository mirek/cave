---
name: website-version-source
description: Remove hard-coded stale release numbers from the site.
status: completed
priority: medium
area: website
source: architecture-review
---

# Derive website versions

## Problem

The website package, footer, and documentation show different release versions because display strings are maintained manually.

## Direction

Read the release version from one generated build datum or package manifest and expose older documentation versions only when intentionally labeled.

## Done when

- Current-version UI has one source of truth.
- CI rejects stale hard-coded current-version strings.
- Historical version labels remain explicit and correct.

## Outcome

The website imports the root package version through one module for the docs
sidebar, docs footer, and site footer. No current release number is copied into
website source.
