---
name: package-readme-accuracy
description: Correct smaller package API inaccuracies.
status: completed
priority: low
area: documentation
source: implementation-audit
---

# Correct package README details

## Problem

Store docs omit the `tx` export option, parser docs promise a diagnostic that does not occur, and core docs incorrectly scope numeric/date classification to `IS`.

## Direction

Audit examples against executable behavior and either correct implementation or state the actual contract.

## Done when

- Public options and classification rules match code and types.
- Every corrected example has a focused test or reproducible command.
- Similar claims across READMEs are searched and aligned.

## Outcome

Store documentation includes transaction-annotated export, core documentation
matches any-verb numeric/date/trajectory classification and exposes `Time`,
and parser documentation distinguishes valid multiword relation objects from
stray tokens after the metadata boundary. The earlier colonless-attribute
diagnostic gap was already covered by parser behavior and tests.
