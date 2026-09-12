---
"@cavelang/cli": patch
---

Capture the asynchronous process runner's abort signal once so changing options cannot miss cancellation or leave a listener attached to the original signal.
