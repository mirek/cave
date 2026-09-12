---
"@cavelang/cli": minor
---

Expose automation report completion explicitly. Pass exhaustion and unfinished
rule derivation no longer count as successful settling: text reports say
incomplete, JSON includes complete, and automate --once exits nonzero while
preserving committed watermarks for resumption.
