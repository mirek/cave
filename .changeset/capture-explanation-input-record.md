---
"@cavelang/scenario": patch
"@cavelang/cli": patch
---

Copy scenario input records before explanation validation so changing getters and later caller mutations cannot replace the values associated with a checked input digest.
