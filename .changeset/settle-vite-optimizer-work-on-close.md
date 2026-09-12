---
"@cavelang/core": patch
---

Patch Vite shutdown to settle pending dependency transforms after optimizer cancellation, with a cold-cache regression on both Node majors.
