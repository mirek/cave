---
name: narrow-screen-overflow
description: Keep the website navigation and home-page content inside the viewport at the CSS minimum width.
priority: medium
area: website
source: Codex exploratory use
audited-commit: 21a9f5b25d660eed886ce288ab8cbb6fbd4ee16c
audited-at: 2026-07-18
---

# Remove narrow-screen website overflow

## Problem

The stylesheet declares a 320 px minimum page width, but the production site
requires horizontal scrolling at that width. In a Chromium run against the
built `/cave/` asset graph:

- the primary navigation started at x=45 and ended at x=337, outside the
  320 px viewport, on the home, docs, and playground routes;
- the docs and playground pages had a 337 px document scroll width; and
- the home page reached 407 px because each capability card resolved to about
  383 px wide in addition to the overflowing header.

The GitHub link is partly off-screen and the home-page cards cannot be read as
a normal single-column mobile layout without panning.

## Direction

Introduce a narrow-screen navigation treatment that preserves access to every
primary destination without overlap or page-level horizontal scrolling. Allow
grid children and long code examples to shrink, wrap, truncate, or scroll
inside their own containers instead of increasing the document width.

Cover the actual production bundle because the overflow spans shared layout,
route-specific content, fonts, and responsive CSS rather than one isolated
component.

## Done when

- Home, docs, and playground routes have no page-level horizontal overflow at
  320 px and common wider phone viewports.
- Every primary navigation destination remains visible or reachable with
  keyboard, pointer, and touch input.
- Capability cards fit their single-column container; long CAVE and command
  examples scroll only inside their code surfaces when necessary.
- A production-browser regression test checks document width and navigation on
  all three routes at the narrow viewport.
- Wider layouts retain the current information hierarchy and usable focus
  order.
