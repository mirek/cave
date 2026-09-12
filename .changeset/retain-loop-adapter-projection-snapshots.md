---
"@cavelang/cli": patch
---

Keep SQLite reconstruction adapter row selection and claim metadata projection
within one short read snapshot. Preserve fresh reads between asynchronous steps,
caller transaction ownership, and combined read/cleanup failures.
