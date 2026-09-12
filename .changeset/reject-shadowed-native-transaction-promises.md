---
"@cavelang/store": patch
"@cavelang/cli": patch
---

Reject native transaction promises even when their then property is shadowed, preserving rollback and observing asynchronous rejection without invoking that property.
