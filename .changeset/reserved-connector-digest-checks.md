---
"@cavelang/cli": patch
"@cavelang/connect": patch
---

Recheck connector record and prelude digests under the write reservation so concurrent identical refreshes skip duplicate appends while force retains its behavior.
