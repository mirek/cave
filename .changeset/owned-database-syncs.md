---
"@cavelang/cli": patch
"@cavelang/sync": patch
---

Reject database-file sync inside caller-owned transactions before attaching or
copying. Prevent failed detaches from leaving merged rows and source attachments
behind, including dry runs. Annotated-text sync remains nestable.
