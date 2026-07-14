---
name: calendar-date-validation
description: Make date classification and parsing agree.
status: open
priority: low
area: temporal
source: implementation-audit
---

# Calendar-date validation

## Problem

`Value.isDateLike` accepts impossible dates and week shapes that `Time.parsePeriod` rejects, so classification depends on which API is used.

## Direction

Centralize structural and calendar validation instead of maintaining a looser regex.

## Done when

- Classification implies successful temporal parsing.
- Leap years, month lengths, ISO weeks, and partial periods are tested.
- Invalid values remain ordinary text or produce the specified diagnostic.
