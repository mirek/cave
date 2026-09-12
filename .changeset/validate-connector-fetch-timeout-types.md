---
"@cavelang/cli": patch
---

Reject null and nonnumeric connector fetch deadlines before network requests without coercing caller values. Preserve whole-millisecond decimal deadlines and the default for omitted settings.
