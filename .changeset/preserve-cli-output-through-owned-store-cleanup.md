---
"@cavelang/cli": patch
---

Unify buffered CLI store cleanup across synchronous and asynchronous commands. Preserve completed output and original diagnostics when closing fails, retain existing failure status, await async work before closing, and document committed-write and overlay boundaries.
