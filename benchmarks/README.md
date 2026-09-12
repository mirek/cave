# Performance trials

Use the regression gate for the recorded workload budgets, or choose a focused
trial below to investigate a specific cost. Package references contain the
measurements, design decisions and limits associated with those trials.

The [linear-classification trial](linear-classification-fold-review.json)
compares wide sums and products before and after removing temporary operand
classification arrays. Run `node scripts/linear-classification-bench.mjs`;
an optional module path selects a comparison implementation. Results include
full model capture and validation, not just the classification loop.

For independent timestamp correctness checks, run
`node scripts/time-boundary-oracle.mjs` with Python 3 available. The
[temporal audit](time-boundary-oracle-review.json) checks UTC conversion,
fractional timestamps, query-boundary width and malformed input on both Node
majors. These are correctness checks, not performance measurements.

For independent arithmetic correctness checks, run
`node scripts/explanation-tree-oracle.mjs` and `node scripts/exact-oracle-check.mjs`
with Python 3 available. These compare against Python `Fraction`; they do not
measure performance or add a Python dependency to the solver runtime.
The [conditional tree audit](conditional-expression-tree-review.json) extends the
tree generator with nested conditionals and explicit skipped/selected invalid
branches: 261 trees and 522 outcome checks per supported Node major.
The wide arithmetic oracle also compares explanation size estimates with Python
integer bit lengths; [recorded bounds checks](explanation-budget-bounds-review.json)
cover signed values, zeros, cancellation and unreduced fraction inputs.
The [current combined audit](intermediate-arithmetic-current-review.json) retains
16,416 arithmetic, explanation, linear-product and size-estimate checks per Node
major, with current solver source fingerprints and no timing claim.
Run `node scripts/explanation-decimal-oracle.mjs` for independent decimal
coefficient/exponent and exact-normalization coverage;
[decimal preflight results](explanation-decimal-budget-review.json) include both
supported Node majors and extreme-exponent zero handling.

The [Z3 deadline probe](../scripts/z3-deadline-probe.mjs) checks short-timeout
responsiveness and recovery with an external process allowance;
[partial reproduction and interrupt-retry results](z3-deadline-retry-review.json)
and the [current-source checkpoint](z3-deadline-current-review.json)
retain both successful calls and a stalled request. See the
[adapter diagnostic](../packages/solver-z3/README.md#deadline-responsiveness-diagnostic)
for scope and reproduction.

The [Z3 memory-recovery diagnostic](../packages/solver-z3/README.md#memory-recovery-diagnostic)
checks repeated memory-limit failures, large domain contradictions and exact
optimization recovery under forced garbage collection. [Initial results](z3-memory-recovery-review.json)
include both supported Node majors and the numeric-budget preflight failure that
previously prevented the large fixture from reaching its backend checks.
A [cleanup recovery checkpoint](z3-cleanup-recovery-review.json) retains three
large cycles per major after deadline-interrupt and queued-release failure fixes,
with source hashes, complete diagnostic events and successful process exits.

A [diagnostic compatibility audit](solver-diagnostic-compatibility-review.json)
replays numeric-budget, flat-product, four shared-product variants, large
intermediate and shared-expression trials on both supported Node majors. All
36 workload cases per major pass their result and validation assertions. This
checks that the trials still exercise their intended computations under current
limits; it does not replace historical before/after measurements or define new
performance gates. The artifact records the commands and current solver source
hashes for reproduction.

The [rational sample-order checkpoint](rational-sample-order-review.json) verifies
sum/product exports on both supported runtimes. These harnesses retain all five
samples in execution order, explicitly discard no warm-up samples and calculate
medians from sorted copies. Earlier saved reports retain their original sample
ordering and source scope.

## Running a trial

From the repository root after installing workspace dependencies:

```sh
pnpm bench:performance
pnpm bench:automation
node --disable-warning=ExperimentalWarning scripts/query-snapshot-bench.mjs
```

Run timing trials individually, with other builds and test suites stopped.
Keep the runtime version, platform, fixture sizes and full output with the
result. Each script defines its sample counts and timing boundaries; inspect
those before comparing measurements. Use the same fixture and environment for
before/after comparisons, and keep correctness assertions enabled.

The performance gate uses [performance-baseline.json](performance-baseline.json)
and rejects missing, malformed or unmatched workload budgets. Focused trials
record measurements and correctness evidence; their timings are not additional
release thresholds. Some scripts compare experimental algorithms or SQL plans:
their output does not mean the alternative is used by production code.

## Find a workload

Every script below runs with `node --disable-warning=ExperimentalWarning` followed
by its repository-relative path. Open its package reference for interpretation.

| Script | Investigates | Reference |
|---|---|---|
| [explanation constant signs](../scripts/solver-numeric-budget-bench.mjs) | Before/after constant comparisons near the numeric budget; [raw samples](explanation-sign-review.json) | [Details](../packages/solver/README.md#explanation-sign-trial) |
| [solver numeric budget](../scripts/solver-numeric-budget-bench.mjs) | Classification and explanation near the default numeric budget; [raw samples](solver-numeric-budget-review.json) | [Details](../packages/solver/README.md#default-numeric-budget-trial) |
| [shared rational products](../scripts/solver-shared-product-bench.mjs) | Intermediate growth under default limits; [raw samples](shared-product-review.json) | [Details](../packages/solver/README.md#shared-product-resource-trial) |
| [explanation product reduction](../scripts/solver-shared-product-bench.mjs) | Before/after normalized products and numeric-budget controls; [raw samples](explanation-product-reduction-review.json) | [Details](../packages/solver/README.md#shared-product-resource-trial) |
| [explanation negation/division](../scripts/solver-shared-product-bench.mjs) | `negate` and `divide` modes with product controls; [raw samples](explanation-unary-reduction-review.json) | [Details](../packages/solver/README.md#shared-product-resource-trial) |
| [explanation integer sums](../scripts/solver-shared-product-bench.mjs) | `add` mode and numeric-budget controls; [raw samples](explanation-integer-sum-review.json) | [Details](../packages/solver/README.md#shared-product-resource-trial) |
| [flat explanation products](../scripts/solver-flat-product-bench.mjs) | Balanced n-ary multiplication; [raw samples](explanation-flat-product-review.json) | [Details](../packages/solver/README.md#balanced-n-ary-explanation-products) |
| [explanation size budget](../scripts/solver-flat-product-bench.mjs) | Permitted-workload control and exact-result oracles; [raw samples](explanation-budget-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [cumulative explanation work](../scripts/solver-cumulative-explanation-bench.mjs) | Independent products near the expression-node limit, with default and small size budgets; [raw samples](explanation-cumulative-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [cumulative rational sums](../scripts/solver-cumulative-sum-bench.mjs) | Distinct-denominator sums near the expression-node limit, with default and small size budgets; [raw samples](explanation-cumulative-sum-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [explanation evaluation reuse](../scripts/solver-cumulative-sum-bench.mjs) | Before/after repeated rational-sum and product reports with ordered-expression reuse; [raw samples](explanation-expression-reuse-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [explanation work-policy probe](../scripts/explanation-work-policy-probe.mjs) | Distinct predicates and experimental cumulative bit accounting; [raw observations](explanation-work-policy-review.json), not a shipped runtime limit | [Details](../packages/solver/README.md#validation-and-identity) |
| [explanation work calibration](../scripts/explanation-work-calibration.mjs) | Existing arithmetic controls under the cumulative allowance; [raw counts](explanation-work-calibration-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [explanation identifier size](../scripts/solver-identifier-size-bench.mjs) | Long repeated variable names and compact evaluation keys; [before/after samples](explanation-identifier-size-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [diagnostic rendering](../scripts/solver-diagnostic-render-bench.mjs) | Plain and control-heavy unknown reasons; exact output and source preservation; [samples](diagnostic-render-review.json) | [Details](../packages/solver/README.md#provenance-and-explanations) |
| [exponent padding](../scripts/solver-exponent-padding-bench.mjs) | Authored exponent text versus numeric expansion allowance and syntax-key size; [samples](exponent-padding-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [explanation enum keys](../scripts/solver-enum-key-bench.mjs) | Repeated enum domain/value strings and compact keys; [before/after samples](explanation-enum-key-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [streamed canonical digests](../scripts/solver-enum-key-bench.mjs) | Complete reports with batched identity hashing; [before/after samples](explanation-streamed-digest-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [canonical serialization batches](../scripts/solver-canonical-serialization-bench.mjs) | Full serialization of 5,000 flat Boolean constraints; [before/after samples](canonical-serialization-batch-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [verified historical exports](../scripts/current-export-history-bench.mjs) | Current-state sparse/dense historical endpoint verification; [samples](verified-historical-export-review.json) | [Details](../packages/store/README.md#current-export-history-trial) |
| [shared canonical preparation](../scripts/solver-canonical-serialization-bench.mjs) | Reuse across 5,000 constraints sharing one expression; [before/after samples](canonical-preparation-sharing-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [unshared preparation control](../scripts/solver-canonical-serialization-bench.mjs) | Pass `5000 unshared` to measure separate expression objects; [before/after samples](canonical-preparation-unshared-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [owned explanation canonicalization](../scripts/solver-cumulative-explanation-bench.mjs) | Before/after removal of repeated model preparation; [raw samples](explanation-owned-canonical-review.json) | [Details](../packages/solver/README.md#validation-and-identity) |
| [fusion fallback](../scripts/fusion-fallback-bench.mjs) | Exact fallback cost and identical-mean shortcut; [raw before/after measurements](fusion-fallback-review.json) | [Details](../packages/fusion/README.md#fallback-cost-trial) |
| [performance](../scripts/performance-bench.mjs) | Budgeted regression workloads | [Details](../README.md#development) |
| [automation](../scripts/automation-bench.mjs) | Rule → automation → action scaling and quiet cycles | [Details](../packages/automate/README.md) |
| [report](../scripts/report-bench.mjs) | Report generation | [Details](../packages/view/README.md) |
| [pagination](../scripts/pagination-bench.mjs) | Bounded query pages and selective post-filters; [current raw samples](pagination-current-review.json) | [Details](../packages/query/README.md) |
| [pagination profile](../scripts/pagination-profile.mjs) | Diagnostic SQL, snapshot, vocabulary and record costs; [raw profiles](pagination-profile-review.json) | [Details](../packages/query/README.md) |
| [pagination row width](../scripts/pagination-row-width-bench.mjs) | Experimental late full-row fetch; [raw results](pagination-row-width-review.json) | [Details](../packages/query/README.md) |
| [current-row join](../scripts/current-join-bench.mjs) | Equality-preserving join trials; use `--plans-only` for the slow variant; [raw evidence](current-join-review.json) | [Details](../packages/query/README.md) |
| [current-row membership](../scripts/current-membership-bench.mjs) | Bounded tuple-membership selection; [SQL controls and page results](pagination-membership-review.json) | [Details](../packages/query/README.md) |
| [current-query](../scripts/current-query-bench.mjs) | Production current-row SQL versus an experimental plan | [Details](../packages/query/README.md) |
| [query-snapshot](../scripts/query-snapshot-bench.mjs) | Query read snapshots, WAL and caller transactions | [Details](../packages/query/README.md#query-read-snapshot-trial) |
| [claim-capture](../scripts/claim-capture-bench.mjs) | Append batches and captured claim projections | [Details](../packages/store/README.md#claim-capture-cost-trial) |
| [empty-export](../scripts/empty-export-bench.mjs) | Exports with no sensitivity-visible claims | [Details](../packages/store/README.md) |
| [current-export-history](../scripts/current-export-history-bench.mjs) | Current exports with historical lineage | [Details](../packages/store/README.md) |
| [dense-current-export](../scripts/dense-current-export-bench.mjs) | Dense historical-edge remapping control | [Details](../packages/store/README.md) |
| [historical statement reuse](../scripts/dense-current-export-bench.mjs) | Dense endpoint verification with reused context/tag queries; [samples](historical-export-statements-review.json) | [Details](../packages/store/README.md#current-export-history-trial) |
| [text-sync-registry](../scripts/text-sync-registry-bench.mjs) | Text sync with unrelated vocabulary history | [Details](../packages/sync/README.md) |
| [shape-query](../scripts/shape-query-bench.mjs) | Shape query workloads | [Details](../packages/shape/README.md) |
| [shape-registry](../scripts/shape-registry-bench.mjs) | Inverse shape checks across many instances | [Details](../packages/shape/README.md) |
| [shape-attribute-registry](../scripts/shape-attribute-registry-bench.mjs) | Attribute shape checks with unrelated vocabulary | [Details](../packages/shape/README.md) |
| [governed-registry](../scripts/governed-registry-bench.mjs) | Idle governed operations with vocabulary history | [Details](../packages/automate/README.md) |
| [derived-vocabulary](../scripts/derived-vocabulary-bench.mjs) | Deriving inverse vocabulary with existing declarations | [Details](../packages/rules/README.md) |
| [rule-watermark](../scripts/rule-watermark-bench.mjs) | Quiet rule runs and policy hashing | [Details](../packages/rules/README.md) |
| [action-registry](../scripts/action-registry-bench.mjs) | Action registry costs | [Details](../packages/act/README.md) |
| [automation-reply-registry](../scripts/automation-reply-registry-bench.mjs) | Automation reply registry costs | [Details](../packages/automate/README.md) |
| [judge-parse](../scripts/judge-parse-bench.mjs) | Nested judge-output parsing | [Details](../packages/eval/README.md) |
| [alias-judge-parse](../scripts/alias-judge-parse-bench.mjs) | Nested alias judge-output parsing | [Details](../packages/shape/README.md) |
| [subject-emission](../scripts/subject-emission-bench.mjs) | Bulk ASCII, Unicode and literal subject emission | [Details](../packages/canonical/README.md) |
| [object-emission](../scripts/object-emission-bench.mjs) | Bulk object-shape emission | [Details](../packages/canonical/README.md) |
| [exact-number](../scripts/exact-number-bench.mjs) | Exact numeric expansion | [Details](../packages/solver/README.md) |
| [exact-zero](../scripts/exact-zero-bench.mjs) | Zero normalization with large denominators | [Details](../packages/solver/README.md#zero-rational-normalization-trial) |
| [exact-unit-denominator](../scripts/exact-unit-denominator-bench.mjs) | Integer text over positive/negative unit denominators | [Details](../packages/solver/README.md#unit-denominator-normalization-trial) |
| [exact-integer-decimal](../scripts/exact-integer-decimal-bench.mjs) | Integer decimal expansion with fractional reduction controls | [Details](../packages/solver/README.md#integer-decimal-expansion-trial) |
| [linear-rational-sum](../scripts/linear-rational-sum-bench.mjs) | Balanced rational sums in classification and explanation, with ordinary-workload controls | [Details](../packages/solver/README.md#exact-arithmetic-and-resource-limits) |
| [linear constant signs](../scripts/linear-rational-sum-bench.mjs) | Nonzero divisor proofs and cancellation controls; [raw samples](linear-sign-review.json) | [Details](../packages/solver/README.md#constant-divisor-sign-trial) |
| [exact-intermediate](../scripts/exact-intermediate-bench.mjs) | Intermediate exact arithmetic growth | [Details](../packages/solver/README.md) |
| [denominator probe comparison](../scripts/fraction-sum-probe-bench.mjs) | Isolated four/six/eight-step variants with balanced execution order; [driver verification](probe-reproducer-review.json) | [Details](../packages/solver/README.md#sum-and-product-cancellation) |
| [exact-sum](../scripts/exact-sum-bench.mjs) | Exact sums; [magnitude-control checkpoint](sum-magnitude-review.json); [probe comparison](six-step-denominator-probe-review.json) | [Details](../packages/solver/README.md) |
| [exact-product](../scripts/exact-product-bench.mjs) | Exact products; [magnitude-control checkpoint](product-magnitude-review.json) | [Details](../packages/solver/README.md) |
| [explanation-sharing](../scripts/explanation-sharing-bench.mjs) | Shared expression graphs and equivalent trees | [Details](../packages/solver/README.md) |
| [exact-comparison-shortcuts](../scripts/exact-comparison-shortcuts-bench.mjs) | Exact comparison shortcuts | [Details](../packages/solver/README.md) |
| [exact-gcd](../scripts/exact-gcd-bench.mjs) | Large greatest-common-divisor workloads | [Details](../packages/solver/README.md) |
| [exact-gcd-strategies](../scripts/exact-gcd-strategies-bench.mjs) | Alternative greatest-common-divisor strategies | [Details](../packages/solver/README.md) |
| [scenario-exact](../scripts/scenario-exact-bench.mjs) | Exact scenario arithmetic and comparison shortcuts | [Details](../packages/scenario/README.md) |
| [scenario-reduction](../scripts/scenario-reduction-bench.mjs) | Scenario reduction and exact value growth | [Details](../packages/scenario/README.md) |
| [exact-decimal-zero](../scripts/exact-decimal-zero-bench.mjs) | Decimal zero-suffix cancellation before bigint construction | [Details](../packages/solver/README.md) |
| [scenario-parse-normalization](../scripts/scenario-parse-normalization-bench.mjs) | Reusing normalized scalar fractions during scenario parsing | [Details](../packages/scenario/README.md#performance-measurements) |
| [exact-cross-product](../scripts/exact-cross-product-bench.mjs) | Unequal cross-products versus a normalized reference, with full timing samples; [runtime checkpoint](unequal-comparison-current-review.json) | [Details](../packages/solver/README.md#reinforcing-order-comparison-trial) |
| [exact-reinforcing-order](../scripts/exact-reinforcing-order-bench.mjs) | Reinforcing fraction order shortcut versus a normalized cross-product reference | [Details](../packages/solver/README.md#reinforcing-order-comparison-trial) |
| [exact-integer-order](../scripts/exact-integer-order-bench.mjs) | Canonical integer text ordering versus reparsing normalized magnitudes | [Details](../packages/solver/README.md#canonical-integer-order-trial) |
| [exact-zero](../scripts/exact-zero-bench.mjs) | Zero detection versus full rational normalization | [Details](../packages/solver/README.md#zero-detection-trial) |
| [exact-product-chain](../scripts/exact-product-chain-bench.mjs) | Linear analysis and explanation of rational product chains | [Details](../packages/solver/README.md) |
| [explanation-equality](../scripts/explanation-equality-bench.mjs) | Repeated equality and inequality checks on large rational assignments | [Details](../packages/solver/README.md) |
| [explanation-intermediate](../scripts/explanation-intermediate-bench.mjs) | Intermediate integer growth during product explanations | [Details](../packages/solver/README.md) |
| [explanation-zero-product](../scripts/explanation-zero-product-bench.mjs) | Zero position in large explained products | [Details](../packages/solver/README.md) |
| [query-record](../scripts/query-record-bench.mjs) | Recorded query capture and snapshot costs | [Details](../packages/query/README.md) |
| [sensitivity-batch](../scripts/sensitivity-batch-bench.mjs) | Solver sensitivity workflow overhead and late request-limit rejection | [Details](../packages/solver/README.md) |
| [projection statement reuse](../scripts/view-projection-bench.mjs) | Five-process before/after comparison with unchanged validation and provenance; [raw samples](view-projection-statements-review.json) | [Details](../packages/view/README.md) |
| [view-projection](../scripts/view-projection-bench.mjs) | Cold, cached and provenance-invalidated entity views with identity validation; [raw samples](view-projection-fidelity-review.json) | [Details](../packages/view/README.md) |
| [view-search](../scripts/view-search-bench.mjs) | Complete search view construction with numeric/text values and metadata | [Details](../packages/view/README.md) |
| [view-lineage](../scripts/view-lineage-bench.mjs) | Wide lineage graphs with shared evidence and distinct metadata; [before/after samples](view-lineage-statements-review.json) | [Details](../packages/view/README.md) |
| [current-search](../scripts/current-search-bench.mjs) | Historical and current-only search with revision-heavy histories and unrelated keys | [Details](../packages/store/README.md#current-search-trial) |

## Interpreting results

A passing correctness check establishes only the fixture's asserted behavior.
A faster median does not establish correctness, a universal speedup, or a resource
bound. Record warm-up, sample aggregation, whether setup is timed, and whether
results describe one operation or a batch. Memory-only results do not establish
disk durability or contention costs. Numeric-growth experiments and alternative
plans need their own limits; follow the discussion in the linked references.

When adding a trial, include it in this index and document its purpose, workload,
validation and measured boundary in the owning package reference. Update the
budgeted gate only when the workload and its baseline have been deliberately
reviewed together.


## Claim input performance checkpoint

After the append-option, prepared-batch, edge-field and claim-projection capture
changes, all 12 existing gate workloads passed on both supported Node majors.
The budgets were unchanged. [Full reports](claim-input-review.json) retain the
store sizes, query plans, measurement evidence and baseline/runtime labels.
These are isolated runs on macOS arm64: Node 24.16.0 with SQLite 3.53.0, and
Node 26.5.0 with SQLite 3.53.3.

| Workload | Node 24 | Node 26 | Existing budget |
|---|---|---|---|
| export | 51.601 ms | 49.265 ms | 750 ms |
| import | 75.270 ms | 67.006 ms | 1,500 ms |
| resolution | 20.467 ms | 20.620 ms | 500 ms |
| shape | 4.027 ms | 2.687 ms | 250 ms |
| boundedQuery | 3.880 ms | 4.229 ms | 250 ms |
| transitiveQuery | 9.998 ms | 10.512 ms | 500 ms |
| highlightPaint | 4.755 ms | 7.343 ms | 100 ms |
| legacyMigration | 211.938 ms | 210.046 ms | 1,000 ms |
| scopedViewSmall | 4.884 ms | 5.201 ms | 250 ms |
| scopedViewLargeCold | 58.355 ms | 58.432 ms | 2,500 ms |
| scopedViewLargeWarm | 24.311 ms | 24.721 ms | 750 ms |
| restrictedViewLarge | 50.615 ms | 58.136 ms | 1,000 ms |

Numbers are workload totals as reported by the gate; some workloads time several
calls. They are not all per-call latencies or multi-run medians. Passing these
fixed fixtures establishes compliance with the existing regression budgets,
not a general throughput guarantee or an isolated cost for input capture.

## Exact products on refreshed runtimes

The 2026-09-09 [full reports](exact-product-runtime-review.json) retain 24
cancelling/coprime multiplication and division workloads each on Node 24.21.0
and Node 26.8.1. Runs were sequential, with other builds and test suites stopped.
All correctness assertions passed. The [solver reference](../packages/solver/README.md)
summarizes the 20,000-digit observations and explains the existing optimization.
These are focused observations, not new performance-gate thresholds or proof of
a general arithmetic resource bound.

The subsequent [direct-intermediate before/after reports](direct-intermediate-review.json)
measure removing decimal serialization and reparsing from linear/explanation
normalization. They retain coprime cases, cancelling controls and all fixture sizes;
the solver reference reports improvements and the small cancelling-case regressions.

The [supported-runtime exact-resource checkpoint](exact-resource-current-review.json)
retains independent Python Fraction oracle results, Fibonacci normalization and
validation timings, and coprime/shared-factor GCD strategy comparisons on Node
26.8.1 and 24.21.0. Runs were sequential; the record includes source hashes and
workload limits. It supplements the historical measurements in the solver guide.

The [current explanation-key checkpoint](explanation-key-current-review.json)
reruns variable-name and enum-name/value trials on both supported Node majors.
It records constant compact-key sizes across 16–8,192-character names alongside
full-report timings and lifetime peak RSS; these are not isolated key timings
or a total-process memory guarantee.

The [shared-predicate key trial](shared-predicate-key-review.json) compares
report-local identity reuse with structural-key lookup for one, 32 and 128
predicates. It retains distinct-root controls, full output hashes, timings and
peak process RSS on both supported Node majors.

The [shared-root oracle checkpoint](shared-root-oracle-review.json) refreshes
16,416 counted Python Fraction/size-estimate checks per Node major after
explanation identity reuse. It records all solver source hashes and preserves
older performance checkpoints as measurements of their original source states.

The [wide-model capture trial](wide-model-capture-review.json) compares portable
copy traversal before/after key-wise enumeration, separately measuring copying
and full reports through the default expression-node limit. Samples, equal
output hashes and lifetime peak RSS cover both supported Node majors.

The [capture topology comparison](capture-topology-review.json) extends the
[wide-capture driver](../scripts/solver-wide-capture-bench.mjs) with shared and
distinct expression objects at equal occurrence counts. It compares copy and
full-report times on both supported Node majors, preserves exact output hashes,
and fingerprints all solver sources plus the lockfile. Peak RSS is process-wide
and includes reference copies and assertions; the record makes no runtime
optimization or universal resource-bound claim.

The [primitive-preflight capture trial](capture-primitive-preflight-review.json)
records a rejected attempt to avoid queueing primitive fields. Candidate and
restored-control cases retain equal output hashes but mixed timings. The record
includes both complete clone sources, solver fingerprints and all samples; the
original runtime was restored exactly.

The [result diagnostic capture trial](result-diagnostic-capture-review.json) uses
an empty model to isolate large backend diagnostic lists. The
[driver](../scripts/solver-result-capture-bench.mjs) compares shared and distinct
entries through capture/validation and full-report assembly, preserving output
hashes, graph ownership assertions and all solver source fingerprints. It records
caller-side costs, not backend execution time or a diagnostic-count limit.

The [owned-report assembly trial](owned-report-assembly-review.json) compares
report construction before/after removing a redundant final graph copy. It
retains diagnostic-list samples and model-heavy controls with equal hashes on
both supported Node majors. Results measure already-captured report assembly;
caller-input capture and backend execution retain their separate costs.

The [enum membership validation trial](enum-membership-validation-review.json)
measures repeated last-member literals across three domain sizes before and after
reusing duplicate-detection sets. The
[driver](../scripts/solver-enum-validation-bench.mjs) verifies exact validation
statistics outside timing and records all solver source fingerprints. Domain
sizes above the default use explicit limits; results do not imply general bounds.

The [indexed enum membership follow-up](enum-indexed-membership-review.json)
retains the optimized timings after building sets from validated own array slots.
Custom iterators no longer substitute members. All statistics match the original
scan baseline; earlier reports retain the implementation they measured.

The [validation input-cost trial](validation-input-cost-review.json) measures
malformed integer text, unknown references and distinct provenance lists under
default model limits. Its [driver](../scripts/solver-validation-input-cost-bench.mjs)
checks bounded classified errors or exact statistics and unchanged reference
lists. It distinguishes emitted-preview size from full-input scanning and
reference cardinality; peak RSS includes fixtures and assertions.

The [invalid enum collection trial](invalid-enum-cost-review.json) measures
1,000–100,000 empty domains rejected under default limits. Its
[driver](../scripts/solver-invalid-enum-cost-bench.mjs) verifies every problem and
unchanged declarations; retained error hashes match across both runtimes. It demonstrates that
member-count limits and bounded value previews do not cap malformed declaration
counts or aggregate diagnostic size.
