---
"@cavelang/query": patch
---

Track raw candidate positions internally so selective small pages use bounded batch reads without skipping later matches. The packed declaration snapshot is refreshed for the two internal window signatures; exported API declarations are unchanged.
