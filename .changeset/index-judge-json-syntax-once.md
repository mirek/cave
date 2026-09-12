---
"@cavelang/cli": patch
"@cavelang/eval": patch
---

Index JSON syntax in linear time before decoding judge answers, avoiding repeated scans of malformed nested spans while preserving recovery and scoring.
