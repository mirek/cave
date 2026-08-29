---
"@cavelang/core": patch
---

The release script now waits up to about four minutes (8 attempts, 5s doubling to a 60s cap) for a just-published package to become visible on npm before tagging, instead of the 14s probe budget that failed the v0.32.3 run after every package had in fact published. Pre-publish registry probes keep their short budget.
