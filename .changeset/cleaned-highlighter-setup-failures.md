---
"@cavelang/highlight": patch
---

Release the compiled query and any allocated parser when highlighter setup fails, preventing native resource leaks during failed creation attempts.
