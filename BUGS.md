# CAVE — Bugs

Each known bug is an independent, self-contained file in [`bugs/`](bugs/).
The index is ordered by severity, most urgent first, so the first entry is the
next bug to address.

To address a bug, first add a regression test and confirm that it fails. Fix
the implementation, confirm the test passes, then delete the bug file and its
index entry. Git history, the regression test, and the fixing commit preserve
the record; fixed bugs are not kept with a completed status.

The review-derived entries were verified against the current implementation
during the 2026-07-10 audit of the first 25 merged pull requests. Duplicate
review comments are consolidated into one bug file.

## Known bugs

- [Multi-process transaction order](bugs/multi-process-tx-order.md) — Define or enforce current-belief ordering across concurrent writers.
- [Example wording](bugs/example-wording.md) — Correct reviewed wording in incident examples.
