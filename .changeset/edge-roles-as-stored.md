---
"@cavelang/core": patch
---

The storage schema's `cave_edge` role comment lists the roles that are actually stored, `WHEN`, `VIA`, `BECAUSE`, and `QUALIFIES`; an `UNLESS` qualifier is persisted as a `WHEN` edge to a negated child.
