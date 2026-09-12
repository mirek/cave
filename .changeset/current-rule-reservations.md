---
"@cavelang/cli": patch
---

Reserve the derivation transaction before reading rules and watermarks, and
refresh vocabulary inside it. Prevent firing rules revoked before the write
reservation and honor inverse declarations added by another connection.
