---
name: readme-action-example
description: Make the documented cave act walkthrough executable.
status: completed
priority: high
area: documentation
source: implementation-audit
---

# Fix the README action example

## Problem

The walkthrough's `?parent EXISTS` precondition matches no explicit existence claim, so the shown `cave act` command exits unsuccessfully.

## Direction

Use a precondition supported by the preceding facts, or add the missing existence claim, then regenerate the transcript.

## Done when

- The example runs from a clean store exactly as written.
- CI or a documentation test executes the walkthrough.
- Output and exit status match the README.

## Outcome

The declaration now uses the already established `?parent PARENT-OF me`
precondition, so `parent=anna` matches the preceding family dataset and the
walkthrough executes from a clean store without inventing an existence row.
