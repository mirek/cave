---
name: homepage-spec-card
type: feat
description: Show the §22 compact spec card on the website homepage as a one-glance summary of the whole language, sourced from the cave-writing skill.
priority: medium
area: website
source: user request (2026-11-04), after the Grammar docs page landed
---

# Homepage spec card

## Context

The Docs → Reference → Grammar page (`#/docs/grammar`) already publishes §22
"Compact Spec Card" from `.claude/skills/cave-writing/SKILL.md`, extracted at
build time by `website/src/lib/grammar-page.ts` (`specSection`). The card fits
the whole surface syntax — claim shape, attribute values with uncertainty,
metadata order, prefix shorthand, `REVERSE`/`RENAMED-TO`, continuations and
qualifiers — into about fifteen lines, which makes it a strong homepage element.

## Scope

- Add a section to `website/src/pages/Home.tsx` (sections today: hero, proof
  strip, manifesto, capabilities, loop section, playground) that renders the
  card's `cave` fence with the existing `CaveCode` highlighter.
- Reuse `specSection(skill, 22)` so the homepage never holds a second copy;
  a renumbered or missing §22 must still fail the build.
- Link the section to `#/docs/grammar` for the full EBNF.
- Check the narrow-screen layout: the card's lines are long (~100 columns) and
  must scroll inside the block rather than overflow the page.

## Done when

- The homepage shows the highlighted card, sourced from the skill, with a link
  to the Grammar page.
- A website test asserts the homepage card matches the skill's §22 body, and
  the browser e2e suite (`website/test/e2e/`) still passes.
- `website/README.md` describes the section and its source.
