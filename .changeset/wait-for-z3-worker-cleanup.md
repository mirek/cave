---
"@cavelang/solver-z3": patch
---

Await Node worker exits before Emscripten clears the Z3 pool's message handlers, eliminating a timer-dependent shutdown race.
