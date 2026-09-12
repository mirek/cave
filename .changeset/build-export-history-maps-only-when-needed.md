---
"@cavelang/store": patch
---

Build current-export historical identity maps only when an edge endpoint needs
remapping, avoiding full-history materialization for absent or already-current edges.
