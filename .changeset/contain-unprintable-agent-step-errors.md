---
"@cavelang/cli": patch
"@cavelang/automate": patch
---

Report unprintable agent exceptions as failed prompt steps without aborting the
automation cycle. Preserve later-step execution and recorded-event ownership,
with coverage for serializable reports and subsequent new events.
