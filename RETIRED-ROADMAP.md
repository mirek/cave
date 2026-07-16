# Retired roadmap

The original roadmap is complete. References of the form “ROADMAP item N” and
“open decision N” resolve here.

| item | shipped | capability |
|---|---|---|
| 1 | 0.6.0 | alias closure (spec §13.6) |
| 2 | 0.7.0 | actor provenance (§9.5) |
| 3 | 0.8.0 | shape expectations + `cave check` (§20) |
| 4 | 0.9.0 | deterministic structured ingestion `cave connect` (§23) |
| 5 | 0.10.0 | MCP serving scope (`--read-only`, `--tools`) |
| 6 | 0.11.0 | as-of queries (§12.3) |
| 7 | 0.12.0 | rules engine `cave derive` (§24) |
| 8 | 0.13.0 | action templates `cave act` (§25) |
| 9 | 0.14.0 | evals harness `cave eval` |
| 10 | 0.15.0 | LLM loop policy (`cave reconstruct --agent`) |
| 11 | 0.16.0 | contradiction resolution (§26) |
| 12 | 0.17.0 | named computation MCP tools (`cave_fuse`, `cave_derive`) |
| 13 | 0.18.0 | alias discovery `cave suggest-alias` (§27) |
| 14 | 0.19.0 | store merge `cave sync` (§28) |
| 15 | 0.20.0 | branching convention (§28.6) |
| 16 | 0.21.0 | automations `cave automate` (§29) |
| 17 | 0.22.0 | human read surface `cave serve` (§30) |
| 18 | 0.23.0 | reports with citations `cave report` (§31) |
| 19 | 0.24.0 | temporal values + `cave query --at` (§32) |

Open decision 1 (sync transaction semantics) was decided in 0.19.0 as spec
§28: keep origin transaction order, use row id as global identity, and apply
the Lamport receive rule. Open decision 2 (alias closure versus claim-key
identity) was decided in 0.6.0 as spec §13.6: use the union of rows and surface
disagreement. Open decision 3 remains active as
[redaction and forgetting](todo/redaction-forgetting.md). Open decision 4 is
resolved by the directional `OLD RENAMED-TO NEW` convention (spec §5.8): the
old spelling remains stable storage identity while the replacement becomes
preferred, preserving append-only history and compatibility.
