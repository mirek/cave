---
"@cavelang/store": patch
---

Hold a deferred read snapshot across inverse vocabulary checks and reverse fact
selection, preventing concurrent commits from labeling new facts with old names.
