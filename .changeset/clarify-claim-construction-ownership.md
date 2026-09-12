---
"@cavelang/core": patch
---

Clarify that Claim.of captures top-level initializer fields while retaining nested read-only object references. Distinguish factory ownership from store insertion capture and avoid implying deep copying or runtime freezing.
