---
"@cavelang/cli": patch
"@cavelang/ingest": patch
---

Stage strict ingestion from an exact SQLite snapshot so existing provenance
and stored claim data survive. Check the final sync report and fail the run
when existing identities conflict instead of reporting an unapplied extraction
as successful.
