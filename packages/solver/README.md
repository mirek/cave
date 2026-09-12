# @cavelang/solver

Solver-neutral TypeScript contracts for CAVE formal reasoning. The package
defines exact, serializable models; validation; capability negotiation;
resource limits; canonical model digests; result states; and linear-subset
recognition. It does not depend on Z3, HiGHS, SQLite, or another CAVE package.

| Task | Start here |
|---|---|
| Submit a model to an adapter | [Quick start](#quick-start) |
| Choose variable sorts, constraints and objectives | [Portable semantics](#portable-semantics) |
| Understand exact arithmetic and resource limits | [Exact arithmetic and resource limits](#exact-arithmetic-and-resource-limits) |
| Validate input and understand model identity | [Validation and identity](#validation-and-identity) |
| Handle statuses, proof markers and result errors | [Adapter results](#adapter-results) |
| Trace inputs, assignments and local evaluations | [Provenance and explanations](#provenance-and-explanations) |
| Compare the shipped adapter with evaluated alternatives | [Backend evaluations](#backend-evaluations) |
| Run feasibility, optimization, counterexample or sensitivity checks | [Verification workflows](#verification-workflows) |

## Quick start

```ts
import { Adapter, Explain, Model, Solve } from '@cavelang/solver'

const model: Model.t = {
  schema: Model.schema,
  variables: [{ id: 'replicas', sort: 'int', min: 1, max: 20 }],
  constraints: [{
    id: 'capacity',
    expression: {
      kind: 'gte',
      left: { kind: 'variable', id: 'replicas' },
      right: { kind: 'literal', sort: 'int', value: 3 }
    }
  }],
  objectives: [{
    id: 'fewest-replicas',
    direction: 'minimize',
    expression: { kind: 'variable', id: 'replicas' }
  }]
}

declare const adapter: Adapter.t
const result = await Solve.run(adapter, model, {
  limits: { timeoutMs: 2_000 }
})
```

## Exact arithmetic and resource limits

Local constraint evaluation has a `maxExplanationBits` size preflight and a
`maxExplanationWork` cumulative arithmetic allowance, described under
[Validation and identity](#validation-and-identity). These bound estimated
fraction sizes and charged arithmetic work, not elapsed time, heap or all report work. Earlier benchmark tables retain their
recorded source revisions and are not acceptance guarantees under this budget.

Jump to a topic:

- [Balanced reductions](#balanced-reductions)
- [Fraction comparisons](#fraction-comparisons)
- [Numeric inputs and expansion limits](#numeric-inputs-and-expansion-limits)
- [Sum and product cancellation](#sum-and-product-cancellation)
- [Assignment growth and reuse](#assignment-growth-and-reuse)
- [Equality and zero-product shortcuts](#equality-and-zero-product-shortcuts)
- [BigInt normalization and chains](#bigint-normalization-and-chains)
- [GCD normalization costs](#gcd-normalization-costs)
- [Independent arithmetic checks](#independent-arithmetic-checks)

### Balanced reductions

Linear classification and explanation evaluation reduce rational sums in
balanced pairs through a shared internal reducer. Exact
addition is associative, so signs, cancellation and zero-divisor detection are
preserved, while fewer reductions normalize a large accumulated fraction.
Operands are still evaluated in their original order before reduction, so
undefined arithmetic is not hidden by later cancellation. Explanation products
also use balanced pairs; subtraction and division retain operand order.

Run `node scripts/linear-rational-sum-bench.mjs` to measure complete linear
classification of `x` divided by a sum of reciprocals with distinct 31-digit
denominators. Each case runs four times; the first is warm-up and the table uses
the median of the remaining three. Local darwin-arm64 measurements compare the
prior sequential reduction with the balanced reduction under the same default
model limits:

| Terms | Node 24.21.0 sequential / balanced (ms) | Node 26.8.1 sequential / balanced (ms) |
|---|---:|---:|
| 32 | 5.35 / 1.50 | 4.67 / 1.44 |
| 128 | 104.02 / 8.36 | 93.08 / 7.70 |
| 512 | 3,103.45 / 66.50 | 2,943.03 / 62.68 |

The same benchmark with an `explain` argument evaluates a positive-sum constraint
through `Explain.report` and checks its reported truth value:
`node scripts/linear-rational-sum-bench.mjs explain`. With the same denominators
and sampling method, local explanation measurements were:

| Terms | Node 24.21.0 sequential / balanced (ms) | Node 26.8.1 sequential / balanced (ms) |
|---|---:|---:|
| 32 | 5.34 / 1.50 | 4.48 / 1.42 |
| 128 | 91.35 / 7.18 | 84.13 / 7.90 |
| 512 | 2,791.28 / 49.69 | 2,679.90 / 50.75 |

Control workloads are available as a third argument: `equal`, `cancelling`, or
`integers` (the default is `distinct`). For example,
`node scripts/linear-rational-sum-bench.mjs explain cancelling` measures adjacent
opposite fractions and verifies that their sum is zero. A separate comparison
alternated old/new execution order over seven pairs, discarded the first pair,
and took the median of six measurements. For 512 terms:

| Operation / control | Node 24.21.0 sequential / balanced (ms) | Node 26.8.1 sequential / balanced (ms) |
|---|---:|---:|
| Linear / equal denominators | 3.84 / 3.74 | 2.86 / 2.90 |
| Linear / cancelling pairs | 2.84 / 2.82 | 2.50 / 2.38 |
| Linear / small integers | 1.74 / 1.65 | 1.62 / 1.59 |
| Explanation / equal denominators | 5.65 / 5.67 | 5.40 / 5.26 |
| Explanation / cancelling pairs | 8.13 / 8.14 | 7.37 / 7.70 |
| Explanation / small integers | 4.21 / 4.13 | 3.98 / 3.97 |

These controls show small differences in both directions. The large reduction
measured for distinct denominators does not imply a speedup for ordinary sums.

These are workload-specific observations, not timing gates or general speedup
guarantees. The largest case uses only 16,384 input digits, illustrating why an
input-size budget alone is not a time budget. Balanced reduction improves this
case without adding a general intermediate-size or arithmetic-work limit.


### Fraction comparisons

`Exact.compare` normalizes and validates both operands before taking comparison
shortcuts. Equal denominators, zero operands and opposite signs compare their
numerators directly. Equal nonzero numerators use denominator order, reversed
for positive numerators.
For same-sign fractions, numerator and denominator order can also reinforce
one another: a smaller positive numerator over a larger denominator is smaller,
with the corresponding sign reversal for negative fractions. Exact comparison
and explanation evaluation return that order without allocating cross-products.
An exhaustive 10,404-case small-integer regression checks the result against
direct cross-products, including negative denominators and opposing orders.
See the [reinforcing-order comparison trial](#reinforcing-order-comparison-trial)
for reproduction instructions and measured costs.

The remaining general path compares the two products directly instead of subtracting
them to construct another intermediate integer. Run
`node scripts/exact-cross-product-bench.mjs` alone to exercise this path with
positive and negative fractions through 100,000 decimal digits. Seven-sample
local medians remained around 37–39 ms on Node 24.21.0 and 26.8.1 before and
after removing the subtraction; this is not evidence of a material speedup or
a general memory/work bound.
A 5,184-pair signed-fraction regression checks ordering against integer arithmetic,
including negative denominators and equivalent forms; a zero operand does not
bypass validation of the other operand.

Local explanation comparisons use the same sign, zero and shared-component
shortcuts on their already-normalized BigInt values. General comparisons still
form cross-products, but compare those products directly without allocating a
difference. This reduces temporary arithmetic without changing comparison
semantics or imposing an intermediate-size budget.

For the public `Exact.compare` API, run
`node scripts/exact-comparison-shortcuts-bench.mjs` alone for five-sample comparisons around powers of ten from 10^10 to 10^100000. At the largest fixture,
medians before → after were:

| Comparison | Node 24.16.0 | Node 26.5.0 |
|---|---:|---:|
| Opposite signs | 37.53 → 31.77 ms | 37.07 → 30.19 ms |
| Equal positive numerators | 37.55 → 35.20 ms | 37.27 → 34.52 ms |
| Equal negative numerators | 37.49 → 35.23 ms | 37.26 → 34.30 ms |

Fixture construction and result assertions are outside timing. Normalization and
parsing remain part of each comparison. These shortcuts avoid unnecessary large
products for these cases; they impose no general intermediate-arithmetic budget.


### Numeric inputs and expansion limits

Exact real literals are decimal strings or numerator/denominator pairs. They
are normalized with `bigint`; no decimal is routed through JavaScript floating
point. Objective array order is lexicographic priority. CAVE confidence is not
part of this model and is never interpreted as a soft-constraint weight.
Model integer inputs and `Exact.integer` accept primitive safe-integer numbers or complete integer strings;
arrays, boxed numbers, `bigint` values, and other coercible objects are rejected.
`Exact.rational` and `Exact.isZero` accept a decimal string or a non-null
numerator/denominator object. Functions and other non-object containers are rejected before their
properties are read, even if they expose numerator/denominator getters. Direct
model validation rejects such callable values rather than accepting a fraction
that numeric preflight counted as zero digits. A corrected pair is checked against
the normal numeric allowance; standalone exact arithmetic remains unbudgeted.
The callable-rejection and corrected-budget checks cover real lower/upper bounds,
real literals and soft-constraint weights. Zero checks still validate the
denominator even when the numerator is zero.
Integer and decimal strings must consume the whole input, including any final
line break. Decimal zero normalizes directly to `0/1` after exponent validation,
without allocating a power of ten; exponents must still be safe integers.
For nonzero values, safe-integer exponent syntax does not guarantee that the
expanded numerator or denominator fits the runtime BigInt limit. Such expansion
can throw `RangeError`; it does not change later exact computations. This is a
runtime representability limit, not a portable numeric-size or time budget.

`Exact.compare` normalizes both operands and returns `-1`, `0` or `1`; even a
comparison against zero validates the other operand's denominator. `Exact.isZero`
checks integer/decimal syntax and the denominator without expanding decimal
powers or parsing large integer magnitudes when text suffices. For example,
`Exact.isZero('1e9007199254740991')` returns `false`, although expanding that value
with `Exact.rational` exceeds practical runtime representability. A successful
zero check therefore establishes zero/nonzero identity, not that normalization
or later arithmetic will fit within a caller's time or memory allowance.

`Exact.fromBigInts(numerator, denominator)` normalizes existing bigint
intermediates directly, returning the same decimal-string `Normalized` pair as
`Exact.rational`. For example, `Exact.fromBigInts(6n, -8n)` returns
`{ numerator: '-3', denominator: '4' }`. It rejects non-bigint arguments and a
zero denominator, preserves canonical zero, and shares rational parsing's GCD
implementation. Scenario arithmetic, linear constant evaluation and explanation
arithmetic use this entry point to avoid converting intermediates to strings
and parsing them again. This does not extend model
integer syntax or impose a size/work budget on standalone Exact helpers.

Reproduce expansion costs with `node scripts/exact-number-bench.mjs` from the
repository root. Each fixed case runs in a fresh child with a 10-second timeout
and a 128 MB V8 old-space setting. That setting is not a total-process memory
cap. Timing covers rational normalization and decimal output conversion, excluding
startup and result assertions. Reported RSS is sampled afterward, includes the
runtime and imports, and is not peak or incremental memory.

A local darwin-arm64 run on 2026-09-08 measured:

| Input | Expanded denominator digits | Node 24.16.0 (ms) | Node 26.5.0 (ms) |
|---|---:|---:|---:|
| `1e-1000` | 1,001 | 0.184 | 0.191 |
| `1e-10000` | 10,001 | 0.367 | 0.382 |
| `1e-100000` | 100,001 | 6.046 | 6.066 |
| `1e-1000000` | 1,000,001 | 93.512 | 91.599 |

These are observations, not CI thresholds. The last input is only 10 bytes.
Model validation now limits aggregate numeric expansion with `maxNumericDigits`
(default 100,000), before constructing BigInts for each bound, literal occurrence
or soft-constraint weight. Direct validation captures each numeric value before
budgeting and parsing it. Canonical serialization (including digests) and linear
analysis capture limits once, validate the model, copy it, then revalidate the
copy under the same limits before their own arithmetic. This
preserves early structural checks and prevents changing getters from substituting
an unchecked larger value. A bound that grows during copying is checked against
the initial numeric budget even if its limit getter would later return a larger
allowance. The default budget rejects the last two benchmark inputs. The standalone `Exact` helpers remain unrestricted, which lets
this benchmark measure their expansion directly.

The budget counts integer digits without the sign, and both fraction components.
For decimal strings it counts coefficient digits plus exponent-added zeros and
the denominator's digits before reduction; leading coefficient zeros count too.
Zero skips exponent expansion but still counts its coefficient and denominator.
Exponent spelling is not included in this expansion count: `1e0000` and `1`
each cost two digits. Consequently, this limit is not an input-text length
limit; leading exponent zeros still require parsing and capture.
Shared literal objects count at every expression occurrence, and costs accumulate
across all bounds, constraints, objectives and soft weights in one validation.
Repeated squaring does not bypass that accounting through shared object identity.
A divisor built by squaring one shared 300-digit real literal eight times counts
256 literal occurrences and fits the default budget; a ninth squaring counts
512 occurrences and exceeds it. Canonical serialization, digests and linear
analysis reject the larger model during validation. This checks one amplification
pattern, not a general bound on intermediate arithmetic work.
Exceeding the budget throws `ModelLimitError` for `maxNumericDigits` before backend
execution; an explicit larger positive safe-integer limit permits larger models.
This bounds numeric representation size, not all arithmetic time, intermediate
expression results or standalone `Exact` calls. Backend memory and timeout
limits remain separate protections.
Sensitivity additionally checks the combined numeric text in all samples and
fixed bindings against `maxNumericDigits` before exact normalization. This
request budget is separate from the model's budget and counts padded digits
and every occurrence. Exceeding it throws `WorkflowValidationError` before any
backend call; a larger explicit limit permits a larger request.
Sensitivity also validates every generated sample model, including fixed
bindings and workflow objectives, before starting the batch. A model and request
can each fit their separate budgets while their combined per-sample model
exceeds a limit; that failure now occurs before any earlier sample is solved.
### Sum and product cancellation

Equal normalized denominators now avoid cross-products during exact comparison
and addition/subtraction in linear constant evaluation and explanations. Addition
still reduces the resulting numerator/denominator, including exact cancellation
to zero. This avoids squaring a common denominator solely to reduce it again;
it does not bound
all intermediate arithmetic or change the numeric-input budget.

Run `node scripts/exact-intermediate-bench.mjs` to reproduce this case across
1,000-, 10,000- and 25,000-digit denominators. Each operation/size runs in a fresh
child with a 10-second timeout and a 128 MB V8 old-space setting (not a total
process cap). The report contains five timed calls and their median; timing
excludes fixture creation, process startup and assertions, but includes the full
comparison, linear analysis or explanation operation. RSS is sampled afterward,
not a peak-memory measurement. Every call checks its exact result. Measurements
are observations, not CI thresholds.

For 25,000-digit denominators on darwin-arm64, a local 2026-09-08 run measured:

| Operation | Node 26.5.0 before (ms) | Node 26.5.0 after (ms) | Node 24.16.0 after (ms) |
|---|---:|---:|---:|
| Exact comparison | 2.247 | 1.771 | 1.727 |
| Linear analysis | 12.328 | 7.443 | 7.581 |
| Explanation | 15.301 | 10.923 | 11.114 |

For unequal denominators, addition/subtraction now probes for a shared factor
before allocating cross-products when both denominators have at least 1,025
bits. The probe takes at most six Euclidean remainders. If it finishes with a
nontrivial GCD, the sum uses the least common denominator; otherwise the ordinary
cross-products remain. Final normalization is unchanged. This deliberately
bounds the number of probe steps, not their time or the resulting arithmetic.
A full preliminary GCD was rejected: on the Fibonacci-denominator fixture below
it roughly doubled complete-operation time despite the newer batched GCD.

`node scripts/exact-sum-bench.mjs` measures addition and subtraction through
linear analysis and explanations for shared denominators `3N, 5N`, nearby
coprime denominators `N, N+2`, and consecutive Fibonacci denominators, at roughly
1,000, 10,000 and 20,000 digits. Here `N` is a power of ten plus one. It uses the
same isolated-child, five-call median, timeout and memory methodology above;
fixture construction is excluded and each call checks classification or the
constraint evaluation. Signed, zero and exact identity regressions separately
check the arithmetic. On darwin-arm64 with Node 26.5.0 on 2026-09-08, the largest
cases measured:

| Operation | Denominators | Linear before/after (ms) | Explanation before/after (ms) |
|---|---|---:|---:|
| Add | Shared | 8.847 / 6.256 | 10.874 / 8.800 |
| Add | Nearby coprime | 11.723 / 12.961 | 17.010 / 17.828 |
| Add | Fibonacci | 21.915 / 23.651 | 30.207 / 29.920 |
| Subtract | Shared | 8.766 / 5.867 | 12.060 / 9.390 |
| Subtract | Nearby coprime | 9.453 / 9.109 | 14.440 / 14.464 |
| Subtract | Fibonacci | 26.294 / 22.226 | 33.921 / 31.998 |

Node 24.16.0 shared-denominator addition/subtraction medians were
6.017/6.089 ms for linear analysis and 8.280/9.203 ms for explanations. These
observations show a shared-factor benefit and mixed coprime results, not a
universal speedup. A common factor requiring more than six remainders to find
is intentionally left to final normalization; general intermediate growth
remains outside the numeric-input budget.

Version 2 of this harness adds untimed exact-magnitude controls. For the
fixture's `x = 1`, the reciprocal of `1/b + 1/d` is `b*d/(b+d)`; subtraction
uses `b*d/(d-b)`. Direct BigInt arithmetic and a separate Euclidean reduction
construct the expected assignment. Equality must accept that value and reject
the value plus one under default model and explanation limits. The three-family checkpoint passes all 36 workloads
and 72 magnitude controls on Node 24.21.0 and 26.8.1; [complete reports and
source hashes](../../benchmarks/sum-magnitude-review.json) retain the samples.
The original timed calls are unchanged. Sampled RSS now includes the extra
reports and is not directly comparable to older observations. These checks
cover the selected shared, nearby and Fibonacci denominators, not every
common-factor or cancellation pattern.

The current sum harness also covers delayed shared factors with denominators
`13N, 21N`. Their GCD takes six Euclidean remainders, so the former four-step
probe fell back to a denominator containing `N` twice. A six-step limit finds
the factor and avoids that squared intermediate; longer probes still stop and
use the ordinary exact path. Signed and reversed-denominator regressions retain
exact values and zero-divisor classification.

An isolated trial compared four, six and eight steps. Six alternating paired
runs at 20,000 digits confirm 15–18% lower delayed-sharing explanation medians
with six steps; Fibonacci controls range from 0.8% faster to 1.9% slower.
Six is the smallest tested limit that finds this factor, with less speculative
coprime work than eight. [Full samples, candidate sources and oracle results](../../benchmarks/six-step-denominator-probe-review.json)
retain all 48 workloads per variant/major, 96 untimed magnitude controls per
full run, and the focused paired trials. The selected implementation passes
all 16,416 independent Python Fraction checks on each supported Node major.
Timing trials ran without concurrent builds/tests. This is a measured tradeoff,
not a general speedup or time limit; the older tables retain their four-step
implementation scope.

Run `node scripts/fraction-sum-probe-bench.mjs` alone to reproduce the comparison
without editing workspace sources. It creates isolated four-, six- and eight-step
copies, focuses on 20,000-digit delayed-shared and Fibonacci explanations, and
rotates all six variant orders. Its six default rounds balance execution order;
`--rounds 1` is a shorter functional smoke check, not stable timing evidence.
The script records source/variant fingerprints and complete reports, validates
workload medians, and removes its copies before returning. [Driver verification](../../benchmarks/probe-reproducer-review.json)
records successful default runs on both Node majors, with 72 workload measurements
and 144 magnitude controls per major. These use a different balanced order from
the earlier two-variant paired trial; its historical measurements stay intact.

Linear constant multiplication/division and explanation arithmetic cancel common
factors across numerators and denominators before forming products. The resulting
fractions still pass through the existing normalizer, preserving signs, exact
zero and computed division-by-zero behavior. This reduces intermediates when
factors cancel; coprime products still grow to their full exact representation.

`node scripts/exact-product-bench.mjs` measures cancelling and coprime products
and quotients through complete linear-analysis and explanation calls at 1,000,
10,000 and 20,000 digits. It uses the same five-call median, isolated-child,
timeout, V8 old-space and sampled-RSS methodology described above. Results are
checked after timing, and model construction is excluded. Its JSON output includes
the child timeout, V8 old-space setting, sample count and timing/RSS scope, so
exported observations retain their measurement limits. On darwin-arm64 with
Node 26.5.0, a 2026-09-08 run measured these 20,000-digit cases:

| Operation | Fractions | Linear before/after (ms) | Explanation before/after (ms) |
|---|---|---:|---:|
| Multiply | Cancelling | 12.248 / 8.023 | 14.849 / 10.847 |
| Multiply | Coprime | 9.012 / 9.017 | 12.882 / 12.929 |
| Divide | Cancelling | 13.303 / 9.873 | 14.719 / 10.711 |
| Divide | Coprime | 9.576 / 9.588 | 12.741 / 12.823 |

These observations show the intended cancellation benefit and the measured
coprime tradeoff; they do not establish a speedup for every input or add a general
arithmetic budget. Standalone `Exact` parsing retains its existing behavior.

Version 2 of the product harness also runs two untimed magnitude controls per
case. With the fixture's assignment `x = 1`, the reciprocal of a cancelling
product/quotient must equal one; the coprime fixture's reciprocal must equal
`n * m`, computed directly with BigInt. An exact-equality report must satisfy
that value and reject the value plus one. These checks use default model and
explanation limits and catch incorrect positive magnitudes that the original
sign-only predicate could miss. All 24 workloads and 48 magnitude controls pass
on each supported Node major; [complete reports and source hashes](../../benchmarks/product-magnitude-review.json)
retain the evidence. Timed workloads remain unchanged, but sampled RSS now
includes the extra control reports and is not directly comparable with earlier
RSS observations. This verifies the selected cancelling/coprime fixtures, not
all intermediate values or arithmetic workloads.

Both version-2 sum/product harnesses retain their five timing samples in execution
order and explicitly report zero discarded warm-up samples. The median is
computed from a sorted copy, so inspecting the exported samples still reveals
first-call effects and variation. Their metadata states that sampled RSS includes
the untimed magnitude controls. A [sample-order checkpoint](../../benchmarks/rational-sample-order-review.json)
verifies all 120 workload records, 600 retained samples and 240 magnitude
controls across both Node majors; each reported median matches its samples.
Earlier saved reports retain their original sorted samples and source hashes.

### Assignment growth and reuse

Repeated assignment values can produce intermediates larger than the model's
numeric-input budget. Run `node scripts/explanation-intermediate-bench.mjs`
alone from the repository root to measure this separately from backend search.
It uses powers of ten with 64, 512 or 4,096 digits and 1, 16 or 64 variable
occurrences in a positive-product constraint, under default limits. One warmup
and five timed complete explanation calls exclude fixture construction and
assertions. For the 4,096-digit assignment, the model contains 8,193 numeric
digits regardless of occurrence count. Before keeping normalized intermediates
as bigints, the measurements were:

| Occurrences | Exact product digits | Node 24.21.0 median (ms) | Node 26.8.1 median (ms) |
|---:|---:|---:|---:|
| 1 | 4,096 | 0.89 | 0.86 |
| 16 | 65,521 | 33.37 | 30.39 |
| 64 | 262,081 | 652.80 | 654.76 |

[Raw measurements](../../benchmarks/explanation-intermediate-runtime-review.json)
record all nine cases on darwin-arm64. Product digit counts follow algebraically
from the powers of ten; the explanation reports only the constraint result and
original assignment. These timings include validation, digesting, capture and
arithmetic, and do not isolate multiplication cost or impose a resource cap.
Each explanation report now reuses normalized assigned values across its hard
and soft constraints. Normalization is lazy, on the first evaluated reference;
the cache belongs to that report's captured assignment and is discarded afterward.
A new report sees updated values even when a caller reuses the assignment object.
This does not cache expression results or bypass operand evaluation.

Using the equality workload below with 64 comparisons of 16384-digit fractions,
per-report reuse reduced unequal-case medians from 175.22/172.99 ms to 3.98/3.89 ms
on Node 24.21.0/26.8.1. Equivalent cases fell from 175.72/174.27 ms to 4.07/4.01 ms.
[Assignment reuse samples](../../benchmarks/explanation-assignment-reuse-review.json)
retain all runs. Use `node scripts/explanation-equality-bench.mjs` alone to reproduce
the current implementation. Results reflect repeated references to two variables;
models with many distinct assignments or expensive expression intermediates have
different costs. The following equality table records the preceding implementation.

### Equality and zero-product shortcuts

Explanation numeric equality and inequality compare the reduced numerator and
positive denominator directly, avoiding cross-products. Ordering comparisons
retain their separate arithmetic path. Sign, zero and differently scaled
fraction regressions verify the canonical-pair invariant.

`node scripts/explanation-equality-bench.mjs` measures 64 alternating equality
and inequality constraints over near-one fractions, including capture,
normalization, validation and digesting. For unequal 16384-digit fractions,
complete-report medians fell from 195.01 to 175.45 ms on Node 24.21.0 and from
194.04 to 172.72 ms on Node 26.8.1. Equivalent-fraction controls were
176.14 → 175.67 ms and 180.67 → 173.86 ms. Each case uses one warmup and five
samples; fixtures and assertions are outside timing, and no backend solver runs.
[Raw equality comparison](../../benchmarks/explanation-equality-review.json)
records the fixed-order runs. These bounded cases do not establish general
speedups or a work limit; repeated operand normalization remains part of the cost.

Explanation multiplication evaluates and type-checks every operand before
checking for zero. If any evaluated numerator is zero, it returns exact zero
without multiplying the nonzero operands together. Errors such as computed
division by zero still produce an indeterminate constraint even when another
operand is zero; hard and soft constraint regressions cover both operand orders.

Run `node scripts/explanation-zero-product-bench.mjs` alone to compare zero-first
and zero-last products with 16/64 nonzero operands of 512/4096 digits. Each case
uses one warmup and five timed complete reports, excluding fixture construction,
assertions and backend solving. For 64 nonzero 4096-digit operands plus a final
zero, medians fell from 32.02 to 3.27 ms on Node 24.21.0 and from 31.77 to 3.32 ms
on Node 26.8.1. Zero-first controls were 3.28 → 3.64 ms and 3.22 → 3.37 ms;
small timing changes and fixed run order do not establish a universal speedup.
[Raw zero-product comparison](../../benchmarks/explanation-zero-product-review.json)
retains every sample. Nested operand evaluation and nonzero products can still
grow large; this optimization does not impose a general arithmetic work cap.

### BigInt normalization and chains

Explanation normalization now reduces bigint intermediates directly using the
existing integer GCD, preserving positive denominators and exact zero without
serializing and reparsing after each arithmetic operation. Public exact-number
representations and explanation assignments remain unchanged. In the same
sequential benchmark, the 4,096-digit, 64-occurrence case falls to 31.86 ms on
Node 24 and 31.53 ms on Node 26, about 95% below the earlier measurements. The
16-occurrence case takes 3.19/3.21 ms; the single-occurrence control takes
0.82/0.85 ms. [After measurements](../../benchmarks/explanation-bigint-normalization-review.json)
retain all samples. This avoids conversion overhead; it does not bound bigint
growth or guarantee the same improvement for other expression shapes.

A sequential runtime-refresh check on 2026-09-09 passed all 24 workloads on
Node 24.21.0 and Node 26.8.1 (darwin-arm64). The 20,000-digit medians were:

| Operation | Fractions | Node 24 linear / explanation (ms) | Node 26 linear / explanation (ms) |
|---|---|---:|---:|
| Multiply | Cancelling | 8.409 / 11.097 | 8.294 / 10.784 |
| Multiply | Coprime | 9.285 / 11.524 | 9.078 / 10.961 |
| Divide | Cancelling | 9.686 / 11.092 | 9.517 / 10.783 |
| Divide | Coprime | 7.616 / 9.165 | 7.365 / 8.857 |

[Full samples and runtime metadata](../../benchmarks/exact-product-runtime-review.json)
retain all fixture sizes. These observations verify the current implementation
on refreshed runtimes; they are not an isolated runtime-speed comparison or a
new release budget. Recorded RSS is measured after each workload, not at its peak.

Direct BigInt normalization removes an additional decimal serialization/parse
round trip from linear and explanation intermediates. Sequential before/after
trials on 2026-09-09 measured these 20,000-digit coprime cases:

| Operation | Node 24.21.0 before / after (ms) | Node 26.8.1 before / after (ms) |
|---|---:|---:|
| Multiply, linear analysis | 9.992 / 7.489 | 9.088 / 7.244 |
| Multiply, explanation | 11.549 / 9.537 | 11.106 / 9.144 |
| Divide, linear analysis | 7.837 / 5.807 | 7.357 / 5.596 |
| Divide, explanation | 9.293 / 7.555 | 8.711 / 6.849 |

[Full before/after samples](../../benchmarks/direct-intermediate-review.json)
include cancelling controls and smaller fixtures. Cancelling 20,000-digit
cases changed little, with both increases and decreases (the largest increase
was 0.529 ms). This is a measured reduction in redundant conversion work, not
a speedup for every input or a bound on intermediate growth. Exact signs,
zero and denominator validation retain the existing normalization semantics.

Linear analysis also retains bigint intermediates across constant multiplication
chains, cross-cancelling each factor and normalizing/serializing the aggregate
once. Every operand is still evaluated before accumulation, including operands
after a zero factor. `node scripts/exact-product-chain-bench.mjs` measures 2, 10
and 18 separately allocated unit fractions with 1,000- or 5,000-digit
denominators, all within the default numeric input budget. The
[paired samples](../../benchmarks/exact-product-chain-review.json) include linear
analysis and unchanged explanation controls, isolated child timeouts and source
hashes. Add `--baseline` to run the prior linear implementation through a
benchmark-only child loader. It verifies the restored source against the recorded
hash and does not edit runtime files; unknown command options fail before any
workload starts. Run baseline and current separately with the intended Node
version. The artifact also retains a later rerun using this loader.
For 5,000-digit denominators, the original linear-analysis medians were:

| Factors | Node 24.21.0 before / after (ms) | Node 26.8.1 before / after (ms) |
|---|---:|---:|
| 2 | 1.20 / 1.20 | 1.27 / 1.23 |
| 10 | 22.23 / 10.56 | 21.99 / 10.59 |
| 18 | 82.62 / 25.22 | 81.89 / 25.38 |

These local measurements show reduced conversion work for longer chains; they
do not impose a general intermediate-size or execution-time bound. The fixture
checks linearity and the satisfied constraint outcome. Separate exact-chain
regressions check signed/zero products by subtracting a directly computed rational
reference and testing the resulting zero/nonzero divisor.

### GCD normalization costs

The digit budget is not a normalization-time guarantee. Consecutive Fibonacci
fractions exercise long Euclidean GCD paths even though their result is already
reduced. `node scripts/exact-gcd-bench.mjs` measures normalization and full model
validation for such fractions using fast-doubling fixture construction outside
the timed calls. Every case asserts that its input fits the default numeric
budget; normalization results must equal the original reduced fraction.

Each operation/index runs in an isolated child with a 10-second allowance for
fixture creation and up to three timed calls, and a 128 MB V8 old-space setting
(not a total-process cap). Completed cases report the median. A timed-out child
reports `status: "timeout"`, its fixture size and any completed samples; the
benchmark continues so one timeout does not erase earlier evidence. Timeout is
not evidence that any single call consumed the entire allowance. RSS is sampled
after completed cases and is not peak memory.

Normalization and product cross-cancellation share a private exact GCD helper.
For operands of at least 1,025 bits it uses leading 64-bit integers to collect
[Lehmer-style Euclidean steps](https://gmplib.org/manual/Lehmer_0027s-Algorithm)
into a matrix. Every step has determinant -1, preserving the GCD. A batch is
accepted only when applying it to the full integers produces nonnegative,
ordered, strictly smaller operands; otherwise one full Euclidean remainder
ensures progress. Batches contain at most 64 steps. Smaller operands retain the
ordinary remainder loop to avoid batching overhead. All calculations use BigInt;
there is no approximation of the fraction or change to numeric limits.

On darwin-arm64 on 2026-09-08, Fibonacci indices 200,000/200,001 produced a
fraction with 83,596 total digits, within the default 100,000-digit budget.
Before batching, each largest child timed out before completing all three
samples. Its one completed normalization/validation sample took
7,211.674/8,664.899 ms on Node 26.5.0 and 8,555.076/7,549.708 ms on Node 24.16.0.
With batching, all cases completed: the largest normalization/validation medians
were 113.473/113.173 ms on Node 26 and 112.404/112.452 ms on Node 24. The smaller
50,000/50,001 case took 13.258/13.342 ms on Node 26, versus the earlier
308.771/306.582 ms medians. These are local measurements, not latency guarantees;
normalization remains synchronous and standalone Exact helpers have no work cap.

`node scripts/exact-gcd-strategies-bench.mjs` compares the helper against the
previous Euclidean loop on deterministic coprime, shared-factor, unit and equal
inputs at 32, 128, 1,024 and 8,192 bits. Each measurement is the median of seven
passes over 100 preconstructed pairs, with exact agreement checked outside the
timed calls. On the same machine, 8,192-bit coprime/shared-factor batches took
80.681/85.361 ms versus 401.557/418.195 ms for Euclid on Node 26, and
87.666/89.227 ms versus 411.694/428.568 ms on Node 24. At 1,024 bits, coprime
batches took 6.273 versus 6.022 ms on Node 26 and 6.338 versus 6.026 ms on Node
24; batching does not improve every workload. Sub-millisecond ordinary cases
are especially sensitive to runtime warmup and measurement noise. This benchmark
compares GCD strategies directly; the Fibonacci benchmark includes parsing,
string conversion and, for validation, the full model validation call.

A [supported-runtime checkpoint](../../benchmarks/exact-resource-current-review.json)
reruns both trials sequentially on Node 26.8.1 and 24.21.0. Every Fibonacci case
completes; the largest normalization/validation medians are 118.865/113.250 ms
and 117.350/119.264 ms respectively. At 8,192 bits, coprime/shared-factor batching
medians are 81.600/82.952 ms versus Euclid's 411.692/429.575 ms on Node 26, and
87.801/89.841 ms versus 417.157/436.452 ms on Node 24. The record retains smaller
controls, harness limits and source hashes. Its independent Python Fraction
oracle also passes 3,600 arithmetic, 3,744 explanation, 1,872 classification and
7,200 budget checks per major. These are fixed-seed and workload-specific results;
they do not bound all intermediate arithmetic or change standalone Exact limits.
A [later oracle checkpoint](../../benchmarks/shared-root-oracle-review.json)
repeats all 16,416 counted checks per major after shared-root evaluation reuse.
It records the current solver source hashes and Python 3.14.5 results on Node
26.8.1 and 24.21.0. This refreshes correctness evidence after the explanation
change; the earlier performance measurements retain their original source scope.


### Independent arithmetic checks

The latest retained run of `scripts/exact-oracle-check.mjs` passes 16,416 checks
per runtime on Node 26.8.1 and 24.21.0 with Python 3.14.5: 3,600 direct arithmetic,
3,744 explanation, 1,872 linear-product and 7,200 size-estimate checks across
600 cases. `benchmarks/intermediate-arithmetic-current-review.json` records both
results and solver source hashes. It includes the six-step denominator probe and
current validation fixes. This is correctness evidence for the cases described
below; it does not refresh the earlier performance measurements.

For an independent arithmetic audit, run `node scripts/exact-oracle-check.mjs`
from the repository root with `python3` available. Python's standard-library
`Fraction` produces expected reduced results for 600 fixed-seed cases at ten
random-generation widths from 1 to 16,384 bits. Families cover arbitrary signs,
shared denominator factors, additive cancellation, reciprocal products, zero
numerators and invalid zero denominators, including widths around the GCD
batching threshold. The script checks normalization and the private sum/product
helpers for addition, subtraction, multiplication and division, plus public
exact comparison: 3,600 comparisons or expected-error checks. Comparison checks
both operand denominators even when zero or opposite signs permit a shortcut.
Division rejects an invalid right-hand fraction before
using the product helper, as the calling arithmetic does.

The same generator supplies independent Python integer bit lengths for operand
values, products, sums and fraction cross-sums. The audit checks that explanation
preflight estimates never fall below those actual sizes, including the raw
unreduced fraction-input estimate. These add 7,200 checks across the same signed,
zero and cancellation fixtures. [Results and source hashes](../../benchmarks/explanation-budget-bounds-review.json)
record both supported Node majors. This checks the estimator's conservatism for
the generated integer/fraction cases; it is not an exhaustive proof, a decimal
exponent audit, or a process-memory/latency bound.

For decimal-specific coverage, run `node scripts/explanation-decimal-oracle.mjs`.
Python `Decimal` parses 680 fixed/seeded decimal forms, and `Fraction` supplies
their exact normalized values. The audit compares preflight estimates with the
unreduced coefficient/power-of-ten integer sizes, checks acceptance at the
estimate and rejection one bit below it, and compares exact normalization.
Forms include signs, leading/trailing zeros, leading/trailing decimal points,
upper/lowercase exponent markers and positive/negative exponents. Six additional
checks send extreme safe exponents through the text preflight: nonzero values
are rejected, while zero values normalize without constructing a power of ten.
[Recorded decimal checks](../../benchmarks/explanation-decimal-budget-review.json)
contain 2,726 checks per supported Node major and source hashes. The public-report
regression also checks small-budget refusal, zero preservation and larger-budget
recovery. This is local evaluation preflight; model validation/canonicalization
has its separate input budget and may normalize literals before evaluation.

The audit also evaluates addition, subtraction, multiplication and division
through explanation reports using signed rational assignments. For valid
assignment denominators, equality with Python's expected fraction must be
satisfied and inequality must be violated. An assigned zero divisor must instead
leave both constraint evaluations indeterminate. These add 3,744 explanation
checks, including the direct bigint normalization path. Invalid assignment
denominators remain covered by the separate arithmetic checks above. This is
a deterministic differential audit, not exhaustive proof over all expressions.

For valid input denominators, the audit also checks linear analysis of two- and
four-factor constant products against independently reduced Python fractions.
Subtracting the reference must produce a zero divisor; offsetting it by one
must produce a nonzero divisor. These add 1,872 linear-analysis checks, including
signs, zeros and reciprocal cancellation. The resulting
[9,216-check audit](../../benchmarks/linear-product-oracle-review.json) passes on
Node 24.21.0 and 26.8.1 against Python 3.14.5.
The same 9,216-check audit also passes after the constant-divisor sign analysis
was introduced, including all 1,872 classification checks;
[the current audit report](../../benchmarks/linear-sign-oracle-review.json)
retains both runtime results and source hashes. The ordinary solver suite also
checks 20,000-level constant divisors under explicit depth limits and counts
shared variable-bearing factors separately. This supports the sign shortcut
and its exact-evaluation fallback within the tested families; it does not supply
an intermediate-work budget or prove all possible expression graphs.

On 2026-09-08, the original 3,000 checks passed on Node 24.16.0 and 26.5.0 against
Python 3.14.5. The expanded 3,600-check audit passed on Node 24.21.0 and 26.8.1
against the same Python version on 2026-09-09. Reports include runtime versions
and the seed. Python is an
explicit dependency of this optional audit, not of the solver or ordinary test
suite. Fixture generation has a 30-second child allowance and a 64 MB output
limit; on Python versions with a decimal conversion limit, the generator sets
it to 25,000 digits for these bounded fixtures, including four-factor references. This audit checks arithmetic
agreement, not model validation coverage, backend behavior, or resource limits.

`Exact.rational` returns a reduced fraction with a positive denominator and
represents zero as `0/1`. `Exact.compare` compares mathematical values exactly,
including adjacent integers beyond JavaScript's safe-integer range when supplied
as strings. Equivalent decimal and fraction forms compare equal.

## Portable semantics

- Integer variables always have inclusive finite bounds. Real variables may
  have either, both, or neither bound because SMT backends support exact
  unbounded rational domains.
- Mixed integer/real arithmetic promotes the integer operand to an exact real.
  Division always returns an exact real; it never uses JavaScript or
  backend-specific integer-division behavior.
  Every division therefore requires the `rationals` capability, even when both
  operands are integer literals or bounded integer variables. This is checked
  before invoking the adapter, including divisions nested in constraints or
  objectives.
- `add`, `subtract`, `multiply`, and `negate` are exact. Multiplication of two
  variable-bearing expressions is portable but requires the
  `nonlinear-arithmetic` capability.
- Hard constraints must be Boolean. Soft constraints are Boolean plus an
  explicit positive rational weight. Confidence, probability, uncertainty,
  cost, and preference weight remain different concepts.
- Objectives are evaluated lexicographically in declaration order. A backend
  must advertise `lexicographic-objectives` when a model contains more than
  one objective.
- Enum domains are named finite sets. Enum literals carry the domain ID, so
  values from unrelated domains can never compare accidentally.
  Domain values must be a nonempty, dense array of distinct primitive strings.
  Empty strings, Unicode, and spaces are valid members; non-string members,
  sparse arrays, and non-array containers fail model validation.

Quantifiers, arrays, bit-vectors, recursive definitions, transcendental
functions, raw SMT-LIB, and solver tactics are deliberately absent. A new
portable operation requires a schema version and adapter capability rather
than falling through to backend-specific behavior.

`Linear.model(model, limits?)` recognizes a conservative LP/MIP subset: numeric
variables, affine objectives, and non-strict affine comparisons, without soft
constraints. Division is affine only when its denominator is a defined,
nonzero numeric constant. A conservative sign analysis first proves unambiguous
constant signs, avoiding construction of large intermediate fractions merely to
establish that a divisor is nonzero. Ambiguous cancellation falls back to exact
rational evaluation, so computed zero divisors are excluded and tiny nonzero
divisors are not rounded away. General SMT models may use totalized arithmetic; their
acceptance by `Validate.model` does not imply membership in this linear subset.
Optional validation limits permit analysis of larger models under the same
explicit bounds used for solving and hashing. Omitting them keeps the default
limits; different sufficient limits do not change the classification.
Classification, sign analysis and exact constant evaluation use explicit stacks and cache
shared expressions within each analysis, so raised depth limits do not depend
on the JavaScript call stack. Repeated factors still count separately when
deciding whether a product is affine.
Classification follows expression structure rather than general symbolic
simplification. With a real variable `x`, `x / 1` is accepted, while
`x / (x - x + 1)` retains a variable-bearing denominator and `0 * x * x`
retains two variable-bearing factors, so both are outside the recognized subset.
A `linear: false` result identifies this subset boundary; it does not prove that
no mathematically equivalent linear formulation exists.

Wide sums and products accumulate classification flags as each operand returns,
without retaining an extra array of operand classifications. Every operand is
still visited, including after the result is already known to be nonlinear.
The [25,000-operand trial](../../benchmarks/linear-classification-fold-review.json)
measures complete calls including validation and capture: product medians move
from 33.05 to 31.79 ms on Node 24.21.0 and 31.55 to 30.31 ms on Node 26.8.1;
sum timings are essentially unchanged (34.97 to 34.84 ms and 32.43 to 32.98 ms).
Run `node scripts/linear-classification-bench.mjs` from the repository root.
This removes one source of temporary allocation; the trial does not measure
peak memory or establish a general classification work bound.

### Constant divisor sign trial

Run `node scripts/linear-rational-sum-bench.mjs linear distinct` from the root;
replace `distinct` with `equal`, `cancelling` or `integers` for controls. The
unchanged trial uses 32, 128 and 512 operands, four calls per case and the median
of the last three. Input construction is outside timing; validation, capture and
classification are inside. Every result is checked. Sequential macOS arm64
runs produced these medians for 512 operands:

| Divisor sum | Node 24 before (ms) | Node 24 after (ms) | Node 26 before (ms) | Node 26 after (ms) |
|---|---:|---:|---:|---:|
| Positive, distinct denominators | 50.897 | 3.067 | 49.148 | 2.966 |
| Positive, equal denominators | 3.171 | 3.045 | 3.109 | 2.997 |
| Cancelling pairs | 3.178 | 3.133 | 3.009 | 2.978 |
| Integers | 2.013 | 2.077 | 1.994 | 1.930 |

[Raw before/after samples and source hashes](../../benchmarks/linear-sign-review.json)
retain the smaller cases too. The distinct-denominator case improves because a
positive sum needs no common denominator to prove it is nonzero. Controls stay
near their earlier timings, including cancellation that still needs exact
arithmetic. This is a bounded classifier measurement, not a general arithmetic
work cap or backend benchmark. Validation limits still apply before analysis,
and undefined subexpressions cannot be hidden by multiplication by zero.

### Default numeric-budget trial

Run `node scripts/solver-numeric-budget-bench.mjs` to compare linear
classification with a full explanation report for a positive sum of fractions
with distinct 100-digit denominators. The classifier uses the sum as a divisor;
the explanation checks that it is positive. Both retain default limits.
The 990-term models charge 99,990 and 99,992 numeric digits respectively against
the default 100,000-digit budget. Validation rejects both 991-term models.
Each allowed fixture also verifies rejection when its numeric limit is set one
digit below its exact charge, so the sign shortcut does not bypass that limit.

Before explanation sign proofs, sequential macOS arm64 runs measured these median milliseconds:

| Terms | Linear, Node 24 | Explanation, Node 24 | Linear, Node 26 | Explanation, Node 26 |
|---|---:|---:|---:|---:|
| 128 | 1.364 | 23.134 | 1.275 | 22.495 |
| 512 | 3.720 | 308.797 | 4.421 | 303.322 |
| 990 | 7.110 | 1072.467 | 6.452 | 1061.653 |

[Raw samples, validation statistics and source hashes](../../benchmarks/solver-numeric-budget-review.json)
retain the complete observations. Each case runs in a fresh child with four
calls; the first is discarded and the other three determine the median.
Construction and assertions are outside timing; the full classifier or report
call, including validation and preparation, is inside. Every result is checked.
The harness allows each child 30 seconds and a 256 MB V8 old-space setting;
these are harness settings, not solver guarantees or a total-memory limit.
In that baseline the classifier avoided constructing the positive sum, while
explanation evaluated it and prepared a report. These timings do not isolate
either cost. The input
budget bounds accepted input size, not intermediate work or execution time;
this trial establishes no bound for other expression shapes or larger overrides.

### Explanation sign trial

Constant numeric comparisons with a literal zero now share the classifier's
conservative sign proof. The proof uses an explicit stack and a report-local
cache. It requires known signs for every product operand and a known nonzero
divisor, so multiplying by zero cannot hide undefined arithmetic. Variables,
conditional expressions and ambiguous cancellation fall back to normal exact
evaluation; assignment checks and Boolean short-circuiting retain their behavior.

Rerunning the default numeric-budget trial on macOS arm64 measured median
milliseconds for complete explanation reports:

| Terms | Node 24 before | Node 24 after | Node 26 before | Node 26 after |
|---|---:|---:|---:|---:|
| 128 | 23.134 | 2.498 | 22.495 | 2.453 |
| 512 | 308.797 | 7.741 | 303.322 | 6.626 |
| 990 | 1072.467 | 15.095 | 1061.653 | 14.386 |

[Before/after samples and source hashes](../../benchmarks/explanation-sign-review.json)
retain the classifier controls, validation statistics and child settings.
At 990 terms the report takes about 14–15 ms instead of 1.06–1.07 seconds for
this positive-sum fixture. Mixed-sign sums may still need exact intermediate
fractions; this optimization establishes no general execution-time bound.

### Shared-product resource trial

Object sharing does not bypass expression-node limits: validation counts each
occurrence. Intermediate arithmetic can still grow substantially. The
[shared-product trial](../../scripts/solver-shared-product-bench.mjs) repeatedly
squares an assigned rational `1 + 10^-50`, then checks equality with one.
The expected result is independently known to be false. All cases pass default
model limits and return that result; only the literal one contributes to the
model's numeric-digit charge. Assignment values are separate from that charge.

Median complete `Explain.report` calls on macOS arm64:

| Squarings | Counted expression nodes | Result denominator digits | Node 24.21.0 ms | Node 26.8.1 ms |
|---|---:|---:|---:|---:|
| 8 | 513 | 12,801 | 42.795 | 43.169 |
| 10 | 2,049 | 51,201 | 519.741 | 516.765 |
| 12 | 8,193 | 204,801 | 7,127.377 | 6,923.401 |

Run `node scripts/solver-shared-product-bench.mjs`. Each case uses a fresh
child with a 30-second timeout and 256 MB V8 old-space allowance; four full
calls are measured, with the first discarded. Those harness allowances are
not library limits or total process-memory guarantees.
[Raw samples and source hashes](../../benchmarks/shared-product-review.json)
record both supported Node majors. This trial establishes a resource gap, not
an incorrect result. Investigate repeated normalization in rational products
and a separate intermediate-work policy; neither input counting nor sign
proofs alone bound arbitrary explanation work.

Explanation multiplication now relies on its existing reduced-fraction
invariant: denominators are positive and numerator/denominator pairs are
coprime. Equal operands can be squared directly; for other products,
cross-cancellation already yields a reduced result. Neither path needs another
GCD over the expanded product. Operand evaluation and type checks still happen
before multiplication, so zero cannot conceal undefined arithmetic.

The same trial after this change measured:

| Squarings | Node 24.21.0 ms | Node 26.8.1 ms |
|---|---:|---:|
| 8 | 2.080 | 1.405 |
| 10 | 6.821 | 5.806 |
| 12 | 26.575 | 25.130 |

The depth-12 case improves by roughly 270 times while retaining the same exact
result. [Before/after samples and numeric-budget controls](../../benchmarks/explanation-product-reduction-review.json)
record the unchanged fixtures and source hashes. This optimization does not
limit intermediate size, and standalone arithmetic and a general work policy
remain separate concerns.

Negation (including subtraction's negated operand) now preserves reduction
directly. Division explicitly rejects a zero divisor, cross-cancels the reduced
operands, and corrects a negative denominator without another GCD. These paths
retain their exact values and local division-by-zero diagnostics.
Run the same harness with `negate` or `divide` to wrap the shared product in
negation or division by negative one. At depth 12, median full-report times were:

| Operation | Node 24 before ms | Node 24 after ms | Node 26 before ms | Node 26 after ms |
|---|---:|---:|---:|---:|
| Negate | 2258.438 | 27.562 | 2170.777 | 24.851 |
| Divide | 2270.091 | 26.183 | 2254.261 | 25.602 |

[All depths, samples and product controls](../../benchmarks/explanation-unary-reduction-review.json)
use the same isolated timing boundaries. This removes redundant reduction
work; general intermediate growth remains a separate resource cost.

Addition retains full reduction for general fractions. Adding zero returns the
other already-validated value; adding an integer preserves coprimality because
`gcd(a + k*b, b) = gcd(a, b)`. These cases now avoid another GCD. All operands
are evaluated and checked before reduction, so an identity cannot hide invalid
arithmetic. Subtraction uses the same addition logic after negation.

The harness's `add` mode adds one to the shared product. Depth-12 median full
reports improve from 2262.235 to 26.185 ms on Node 24 and 2176.365 to 27.066 ms
on Node 26. [All depths and numeric-budget controls](../../benchmarks/explanation-integer-sum-review.json)
retain the raw samples and source hashes. General non-integral sums still
require reduction, and this shortcut supplies no intermediate-work limit.

The combined reduced-fraction shortcuts are also checked against Python's
independent `Fraction` implementation. Run
`node scripts/explanation-tree-oracle.mjs` with Python 3 available. Its seeded
256 mixed expression trees combine addition, subtraction, multiplication,
division, negation and conditional branches with unreduced assignments and integer
operands. Five explicit cases additionally select or skip division by zero in
both branch directions and reject a failing condition before branch selection.
Each tree checks equality and inequality against the independent exact result;
division-by-zero cases must retain indeterminate evaluations and diagnostics,
including zero multiplied by undefined arithmetic. Version 2 passed 522 outcome
checks across 261 trees on both supported Node majors, with 49 indeterminate
trees and matching fixture hashes. This is a correctness audit, not a timing
benchmark or an exhaustive proof for every expression.
`benchmarks/conditional-expression-tree-review.json` retains those results and
solver source hashes. The [earlier arithmetic-only results](../../benchmarks/explanation-arithmetic-oracle-review.json)
retain their original corpus and the companion wide-arithmetic oracle.

Version 3 adds 80 compound trees with equal, shared-factor, coprime and
unequal-scale denominators at 350 and 2,000 scale digits. Positive and negative
terms flow through sums, scaled products, quotients, exact cancellation and
computed zero divisors. Each added tree also checks failure with an explanation
work allowance of 1 and an identical outcome after retry with fresh default
limits. Constant-divisor classification is checked against Python's defined,
nonzero result. The [recorded compound audit](../../benchmarks/compound-fraction-oracle-review.json)
passes 1,162 checks across all 341 trees on Node 24.21.0 and 26.5.0, with 65
division-indeterminate trees and matching fixture hashes. Python's integer-text
conversion allowance is raised to 20,000 digits for these controlled fixtures.
This adds correctness and retry evidence, not a solver runtime dependency,
performance measurement or universal arithmetic bound.

### Balanced n-ary explanation products

Explanation multiplication now combines an operand list in balanced pairs,
using the same reducer as addition. This avoids repeatedly combining a small
factor with an ever-growing fraction. Exact multiplication is associative;
all operands are still evaluated and type-checked before reduction, and a zero
factor still cannot conceal undefined arithmetic in another operand.

The [flat-product trial](../../scripts/solver-flat-product-bench.mjs) multiplies
independently constructed references to an assigned rational `1 + 10^-50`.
Every factor exceeds one, so the expected comparison is independently known.
All fixtures pass default model limits. Median complete report times on macOS
arm64 were:

| Factors | Node 24 before ms | Node 24 after ms | Node 26 before ms | Node 26 after ms |
|---|---:|---:|---:|---:|
| 128 | 2.662 | 1.443 | 2.604 | 1.323 |
| 1,024 | 106.927 | 9.629 | 104.924 | 7.768 |
| 4,096 | 1,648.504 | 40.996 | 1,623.321 | 37.995 |

Run `node scripts/solver-flat-product-bench.mjs`. The harness runs each size in
a fresh child, measures four full calls and discards the first. Timing runs
are sequential, with a 30-second child timeout and 256 MB V8 old-space allowance;
these are harness controls, not library resource limits.
[Raw samples and source hashes](../../benchmarks/explanation-flat-product-review.json)
retain before/after evidence for both supported Node majors. The largest case
still constructs a 204,801-digit denominator. This improves the measured
repeated-factor workload by roughly 40 times; it does not guarantee a speedup
for every factor distribution or impose an intermediate-work bound.

## Validation and identity

`Validate.model` checks schema version, identifiers, duplicate declarations,
exact numerals, bounds, enum membership, references, expression sorts,
constraint/objective types, and preflight model-size limits. Invalid or
unsupported models fail before an adapter runs.

Jump to a topic:

- [Capture order](#capture-order)
- [Capture measurements](#capture-measurements)
- [Model structure and default limits](#model-structure-and-default-limits)
- [Enum membership measurements](#enum-membership-measurements)
- [Validation input costs](#validation-input-costs)
- [Local explanation budgets](#local-explanation-budgets)
- [Evaluation reuse and syntax keys](#evaluation-reuse-and-syntax-keys)
- [Canonical serialization costs](#canonical-serialization-costs)
- [Cumulative work calibration](#cumulative-work-calibration)
- [Preflight and captured inputs](#preflight-and-captured-inputs)
- [Canonical model identity](#canonical-model-identity)

### Capture order

Validation and capture occur in this order at the public boundaries. The solve
calls below are `Solve.run` and `Solve.runWithExplanation`:

| Entry point | Order before model use |
| --- | --- |
| `Validate.model` | Validate caller data directly, capturing individual numeric fields for their checks. |
| Solve calls | Capture the model, validate that snapshot, then freeze it before adapter execution. |
| `Explain.report` | Capture the model and backend result; validate the model while deriving its digest before local evaluation. |
| Canonicalization and linear analysis | Validate input, capture it, then validate the captured model again. |

The solve/report order keeps changing getters from supplying different values
to validation and execution. Declaration, node and numeric limits apply to the
validated model; they do not bound every allocation or accessor operation needed
to capture it first. Backend time and memory limits likewise do not describe
total caller-side model/result copying. Copy failures propagate through the
public call, with corrected-input retry covered separately below.

Portable record/array copying now enumerates keys and inspects one descriptor
at a time, then copies values by key. This avoids retaining whole descriptor
and entry arrays for wide objects while preserving native fallback for
accessors, proxies and other containers. Shared references, cycles, sparse
arrays, named array fields and ignored non-enumerable/symbol properties retain
the existing copy behavior.
### Capture measurements

These trials measure different costs and source revisions. Follow each record
for its fixtures and source hashes:

- [Model copying and object sharing](#model-copying-and-object-sharing)
- [Rejected primitive preflight](#rejected-primitive-preflight)
- [Backend diagnostic baseline](#backend-diagnostic-baseline)
- [Current report assembly](#current-report-assembly)

#### Model copying and object sharing

The [wide-capture trial](../../scripts/solver-wide-capture-bench.mjs) separates
copy timing from full reports at 1,001, 25,001 and 100,000 expression nodes.
For the largest case, copy medians change from 58.948 to 35.073 ms on Node
26.8.1 and from 49.961 to 37.047 ms on Node 24.21.0. Full-report medians change
from 167.536 to 135.687 ms and 171.823 to 158.420 ms respectively. All output
hashes agree. [All samples, source hashes and peak RSS](../../benchmarks/wide-model-capture-review.json)
retain small-case controls, including a small report slowdown on Node 24.
The trial uses sequential fresh children and four calls, discarding the first.
Peak RSS includes construction, reference copies and assertions; lower observed
RSS does not establish a total memory limit. The external 60-second/256 MB
old-space controls are benchmark allowances, not API guarantees.

The driver now compares a shared leaf with distinct, equal-valued leaves at each
size and mode, checking equal serialized output hashes across both topologies.
The [topology comparison](../../benchmarks/capture-topology-review.json) records
all solver source hashes and the lockfile. At 100,000 expression occurrences,
shared/distinct copy medians are 29.34/92.12 ms on Node 26.8.1 and 33.84/99.18 ms
on Node 24.21.0; full-report medians are 130.35/302.39 ms and 148.29/327.85 ms.
These are local measurements of the same runtime, not before/after optimization
results. Distinct objects require more copying even at an equal validation node
count. Lifetime RSS includes the fixture, native reference copy where applicable,
assertions and repeated calls; the old-space allowance is not a process RSS cap.

#### Rejected primitive preflight

An [isolated primitive-preflight trial](../../benchmarks/capture-primitive-preflight-review.json)
checked function/symbol fields immediately and queued only object-valued fields.
Output hashes matched, but timings were mixed: at the largest fixture on Node 26,
shared copying measured 36.77 ms versus 30.92 ms for the restored control, and
distinct-object reports measured 323.72 versus 308.72 ms. Some other cases improved
slightly. This sequential trial did not establish a consistent benefit, so the
original traversal was restored; it does not justify changing capture semantics.

#### Backend diagnostic baseline

The [result-capture driver](../../scripts/solver-result-capture-bench.mjs) measures
1,000, 25,000 and 100,000 backend diagnostic entries with an empty model. Run
`node scripts/solver-result-capture-bench.mjs` alone from the repository root.
It compares repeated shared entries with distinct equal-valued entries, measuring
result capture/validation separately from complete report construction.
[Samples and source fingerprints](../../benchmarks/result-diagnostic-capture-review.json)
record matching output hashes and detached diagnostic graphs on both Node majors.
This baseline predates the report-assembly optimization below. At 100,000 shared/distinct entries, capture medians are 31.81/115.21 ms on Node
26.8.1 and 32.91/110.54 ms on Node 24.21.0; report medians are 64.87/251.37 ms
and 64.01/221.89 ms. These measure copying and assembly, not backend execution.
Result metadata validation checks each diagnostic's shape but imposes no entry-
count limit; model node limits do not bound this list. The backend output ceiling
is a separate contract. Fixture/reference copies, hashing and assertions are
outside timing but contribute to process peak RSS. The 60-second child timeout
and 256 MB old-space allowance are diagnostic controls, not library guarantees.

#### Current report assembly

Report assembly now reuses its captured model, result and context data plus newly
constructed fields, avoiding a second copy of the completed report envelope.
Returned data remains detached from caller inputs; mutating report metadata,
assignments, provenance, context or limits cannot change a later report. Shared
references inside captured graphs remain shared in the report.
The [assembly trial](../../benchmarks/owned-report-assembly-review.json) records
identical before/after output hashes. Full-report medians for 100,000 diagnostic
entries are:

| Runtime | Diagnostic objects | Before (ms) | After (ms) |
|---|---|---:|---:|
| Node 26.8.1 | Shared | 64.87 | 33.56 |
| Node 26.8.1 | Distinct | 251.37 | 114.70 |
| Node 24.21.0 | Shared | 64.01 | 33.36 |
| Node 24.21.0 | Distinct | 221.89 | 116.00 |

Model-heavy controls also retain equal hashes; their timings vary because the
removed copy is small in those fixtures. This reduces repeated copying, not backend execution or the cost of
capturing caller inputs, and introduces no new resource limit.

### Model structure and default limits

Every objective must explicitly use `direction: 'minimize'` or
`direction: 'maximize'`. Missing or other direction values raise
`ModelValidationError` before adapter execution or canonical digest generation;
they do not select a default optimization direction. Corrected models can retry.

The model must be an object with `variables` and `constraints` arrays; optional
`enums`, `softConstraints`, and `objectives` must also be arrays when supplied.
Declaration lists must contain objects in their own indexed slots. Missing slots
reject before any inherited getter runs, across all five declaration lists;
defining the missing own entry permits a corrected retry. Expressions must be objects,
and `and`, `or`, `add`, and `multiply` require dense operand arrays containing
expression objects in their own indexed slots. Inherited entries do not fill
holes; validation rejects a missing slot without reading its inherited getter.
Defining the missing own entry permits validation of the repaired array. Malformed runtime structures produce `Validate.ModelValidationError`
with their field path rather than silently skipping missing declarations.
Declaration and operand checks traverse indexed entries directly; caller-defined
`map` or `forEach` methods cannot suppress these checks and are not invoked.
Model declaration IDs must be primitive strings fully matching
`[A-Za-z][A-Za-z0-9._:/-]*`; trailing line breaks and coercible objects are
rejected for variables, enum domains, hard/soft constraints, and objectives.
Diagnostics for duplicate identifiers, unknown variable/domain references, enum
members and unsupported expression kinds quote short primitive text normally. Malformed
object, BigInt, function or symbol values are described by type (for example,
`<object>` or `<bigint>`) without traversing them or invoking `toJSON`. Cyclic and
BigInt values therefore retain classified `ModelValidationError` diagnostics
instead of failing during error formatting. Corrected input can be retried.
This diagnostic behavior does not change getter or native-clone behavior at
entrypoints that capture caller data before validation.
Exact-number syntax and exponent-range errors, identifier/domain/member errors,
unsupported expression kinds, malformed sorts and invalid option/limit names or
primitive values share text previews.
Inputs up to 160 UTF-16 code units keep their existing display. Longer values
show the first and last 80 code units, JSON-escaped, plus the original length.
This bounds each input preview while preserving its ends; it does not bound
full-input scanning or aggregate model diagnostics.
The supplied value remains unchanged, and corrected input can retry.
Provenance reference lists (`evidenceRowIds` and `scenarioInputIds`) validate
their own indexed strings. Custom iterators cannot hide duplicates, and sparse
slots reject without invoking inherited getters. Repairing the same list permits
a fresh validation.
Sort-mismatch diagnostics also describe malformed variable sorts by type without
coercing caller objects. A reference to an invalid declaration therefore retains
the declaration error alongside expression errors.
Variables and literals must use a declared portable sort (`bool`, `int`, `real`,
or `enum`). Boolean literals require primitive Boolean values; truthy strings
and numeric substitutes are rejected, and unknown literal sorts never fall
through to variable lookup.
Enum membership and duplicate detection share a set built from the domain's own
indexed entries for one validation call. Custom array iterators cannot substitute
members or hide duplicates, and missing slots reject without inherited reads. Mutating a domain between calls produces a fresh index; duplicate values
still reject, and shared literal objects still count at every occurrence.
See [Enum membership measurements](#enum-membership-measurements) for the
workload and measured costs.

Operational limits cover time, working memory, declarations, enum values,
expression nodes/depth and output size. `Adapter.defaultLimits` supplies these
defaults; every resolved limit is passed to the selected adapter:

| Limit | Default | Meaning |
|---|---:|---|
| `timeoutMs` | 10,000 | Backend execution deadline in milliseconds. |
| `maxMemoryBytes` | 536,870,912 (512 MiB) | Backend working-memory ceiling; adapters must reject or isolate when they cannot enforce it. |
| `maxVariables` | 1,000 | Variable declarations. |
| `maxConstraints` | 5,000 | Hard and soft constraints combined. |
| `maxObjectives` | 16 | Objective declarations. |
| `maxEnumValues` | 1,000 | Values across enum domains. |
| `maxExpressionNodes` | 100,000 | Expression-node occurrences. |
| `maxExpressionDepth` | 128 | Expression nesting depth. |
| `maxNumericDigits` | 100,000 | Aggregate pre-reduction digits across numeric bounds, literal occurrences and soft weights. |
| `maxExplanationBits` | 1,000,000 | Conservative size estimate for integers used during local hard/soft constraint evaluation. |
| `maxExplanationWork` | 10,000,000 | Cumulative estimated-bit charges across local hard/soft constraint evaluation in one report. |
| `maxOutputBytes` | 1,000,000 | Backend output-size ceiling in bytes. |

These limits govern validation, local explanation evaluation and backend execution. Solve entry points capture
the model before validation; the validation traversal limits do not bound that
initial copy.

### Enum membership measurements

The enum validation trial uses 100, 1,000 and 10,000 values with 20 or 20,000
last-member literal occurrences. The table shows the 20,000-occurrence cases;
all before/after runs produce identical validated statistics. The current results
use the indexed-entry implementation; the baseline used repeated array scans.

| Node | Enum values | Before (ms) | After (ms) |
| --- | ---: | ---: | ---: |
| 26 | 1,000 (default limit) | 25.83 | 6.31 |
| 24 | 1,000 (default limit) | 58.30 | 7.12 |
| 26 | 10,000 (explicit override) | 203.24 | 7.83 |
| 24 | 10,000 (explicit override) | 523.48 | 7.89 |

Small controls are mixed. The index retains one set per domain until validation
ends; these timings do not establish a universal time or memory bound.
Reproduce with `node scripts/solver-enum-validation-bench.mjs`; full samples and
source hashes are in `benchmarks/enum-indexed-membership-review.json`; the
original scan baseline and earlier iterator-based trial remain in
`benchmarks/enum-membership-validation-review.json`.

### Validation input costs

Small diagnostic previews do not bound the work required to inspect supplied
input. A direct-validation trial uses 1,000, 100,000 and 1,000,000 input code
units or provenance references under default model limits. The table compares
Node 26.8.1 and 24.21.0 at one million code units for each text case and one
million references for the provenance case:

| Input | Node 26 (ms) | Node 24 (ms) |
| --- | ---: | ---: |
| Invalid integer ending in `x` | 11.99 | 11.99 |
| Unknown variable ID; empty variable map | 0.04 | 0.07 |
| Distinct evidence references on one Boolean variable | 150.14 | 244.46 |

The invalid integer is scanned for syntax; it is not a valid numeral charged by
`maxNumericDigits`. Its error stays at 272 characters. The unknown-ID case uses
an empty lookup map and repeated calls on the same text, so it does not establish
first-use or populated-map lookup costs. Provenance references are checked for
string validity and duplicates, but their count is not covered by variable,
expression-node or numeric-digit limits. Callers managing large workloads must
account for reference-list size separately.

Each case runs four validations in a fresh child and discards the first for its
median. Fixtures, assertions and hashing are outside timing. Recorded process
peak RSS includes fixture strings, repeated calls and assertions; it is not
isolated validator memory or a hard process cap. Full samples, classified output
hashes and source fingerprints are in `benchmarks/validation-input-cost-review.json`;
reproduce with `node scripts/solver-validation-input-cost-bench.mjs`.
Malformed collections also have separate costs. A valid enum domain must contain
at least one value, but a large list of empty domains contributes zero members to
`maxEnumValues` while accumulating validation problems. A controlled trial of
100,000 empty domains rejects all of them in median 42.67 ms on Node 26 and
60.57 ms on Node 24, producing 100,000 problems and a 4,688,911-character error.
Bounded value previews do not cap the number of problems or the final error size.
Applications needing a bound on malformed-collection work must constrain raw
collection cardinality before calling validation. Full 1,000/10,000/100,000-domain
samples and source hashes are in `benchmarks/invalid-enum-cost-review.json`;
reproduce with `node scripts/solver-invalid-enum-cost-bench.mjs`.

Expression diagnostic paths use fixed field names and array indexes rather than
caller-supplied identifiers. Their nesting follows `maxExpressionDepth` (128 by
default); validation rejects depth 129 before inspecting that child's fields.
The parent has already read the child reference and formed its path when this
check runs, so this is not a guarantee against parent getters. Raising the depth
limit also permits longer paths. Iterative traversal avoids recursive call-stack
growth, but retained frame paths and accumulated errors still consume memory;
the depth limit is not a total diagnostic-size or process-memory budget.

These finite trials do not bound all malformed collections, diagnostic counts,
string lengths or capture work before validation.

### Local explanation budgets

`maxExplanationBits` is enforced by explanation evaluation, independently of the
backend's time and memory limits. Before parsing a numeric value it charges four
bits per pre-reduction decimal digit, including both members of a supplied
fraction. Before arithmetic it bounds numerator, denominator and comparison
cross-products using operand bit lengths; addition allows a carry bit. These
estimates are deliberately conservative: a calculation may be refused even if
cross-cancellation or later reduction would produce a small answer. Equal
denominators, zero/one factors and existing comparison shortcuts avoid needless
growth estimates where the implementation does not allocate those products.

Exceeding this budget makes the affected constraint `indeterminate` with a
`maxExplanationBits` evaluation reason. It preserves the backend's satisfied or
optimal status, assignment and other report metadata; independent constraints
continue evaluating. A later report with a larger limit can evaluate the same
captured inputs. Unevaluated Boolean/conditional branches do not consume this
budget, and constant-sign proofs may avoid expanded arithmetic altogether.
The report records the resolved limit. Historical recorded reports that omit it
keep their original limit metadata when read or replayed.

`maxExplanationWork` accumulates the largest estimated bit bound at each
successful size check, including numeric input preflight and guarded arithmetic.
The default is 10,000,000 units per report, shared by hard and soft constraints.
A charge that exceeds the remaining allowance fails before that guarded operation
and leaves the remaining allowance available for cheaper later work. Its local
failure names `maxExplanationWork`; the backend result stays intact. Size checks
run first, so an operation exceeding both limits reports `maxExplanationBits`.
Previously completed identical predicates and captured assignments can be reused
without repeating their charged work; unevaluated branches incur no charge.
Constraint order can therefore affect which distinct evaluations finish. A fresh
report resets the allowance, and its resolved limits record the selected value.
Historical recorded reports retain their original fields during read and replay.

This accounting is an implementation-level estimate, not elapsed time or a
portable instruction count. It excludes model/result copying, validation, syntax
keys, unguarded traversal, formatting (including soft-weight normalization),
standalone `Exact` helpers, linear classification and backend execution. Neither
arithmetic guard is a total-process memory limit or a general sandbox.

The default-budget regression rejects shared assigned growth that still passes
model input limits, and a small-budget regression verifies recovery with a larger
limit. The permitted 4,096-factor flat-product control has median full-report
times of 51.364 ms on Node 24.21.0 and 46.080 ms on Node 26.8.1 with the guard
enabled. [Samples, source hashes and independent oracle checks](../../benchmarks/explanation-budget-review.json)
record the measurement and exact-result checks; these timings are not deadlines.

A [cumulative trial](../../scripts/solver-cumulative-explanation-bench.mjs) repeats
independently constructed 4,096-factor constraints at 1, 8 and 24 constraints.
The largest model has 98,376 expression nodes and passes default model limits;
a 25th constraint exceeds `maxExpressionNodes` and is rejected. Every permitted
product exceeds one. Median complete report times on macOS arm64 were:

| Constraints | Node 24 default ms | Node 26 default ms | Node 24 1,024-bit budget ms | Node 26 1,024-bit budget ms |
|---|---:|---:|---:|---:|
| 1 | 51.679 | 45.382 | 27.379 | 23.923 |
| 8 | 371.183 | 331.596 | 210.137 | 163.608 |
| 24 | 1,082.233 | 1,005.619 | 561.014 | 501.721 |

With the default 1,000,000-bit guard every constraint evaluates as satisfied;
with 1,024 bits every constraint becomes indeterminate. The smaller budget
reduces arithmetic growth but does not remove report preparation or traversal
cost. These full-call timings do not isolate individual phases. In particular,
the size guard is not a cumulative-work or elapsed-time budget, even when it
rejects all constraint evaluations.

Run `node scripts/solver-cumulative-explanation-bench.mjs` with no concurrent
builds or tests. Each count/budget pair uses a fresh child and four complete
calls, discarding the first for the median; each child has a 30-second timeout
and 256 MB V8 old-space allowance. These harness controls are not runtime limits.
[Raw samples and source hashes](../../benchmarks/explanation-cumulative-review.json)
record both supported Node majors. This product-only trial did not establish a
general threshold; the complementary sum trial and calibration below informed
the current arithmetic allowance.

The report now canonicalizes its already-owned model through a private path.
That path still validates the captured model before hashing, but avoids a
second model copy and a redundant validation pass. Public `Canonical.serialize`
and `Canonical.digest` retain validation before and after capture, including
protection against changing getters. Model identity and explanation evaluation
continue to use the same captured values.

Repeating the same trial after this preparation change reduced the 24-constraint
default-budget median from 1,082.233 to 955.029 ms on Node 24 and from 1,005.619
to 871.218 ms on Node 26. At 1,024 bits the corresponding medians fell from
561.014 to 416.838 ms and from 501.721 to 372.641 ms. The other model sizes and
all samples are preserved in the
[before/after preparation results](../../benchmarks/explanation-owned-canonical-review.json).
The measurements use the same sequential harness controls described above.
This removes repeated work; it does not impose a cumulative resource ceiling.

A complementary [cumulative rational-sum trial](../../scripts/solver-cumulative-sum-bench.mjs)
uses 256 assigned positive fractions with distinct 101-digit denominators in
each independently constructed constraint. At 384 constraints the model has
99,456 expression nodes and passes default validation; adding three constraints
exceeds the node limit. Before report-scoped expression reuse, the full report
medians on macOS arm64 were:

| Constraints | Node 24 default ms | Node 26 default ms | Node 24 1,024-bit budget ms | Node 26 1,024-bit budget ms |
|---|---:|---:|---:|---:|
| 1 | 84.572 | 81.458 | 5.904 | 5.065 |
| 32 | 2,594.413 | 2,474.570 | 48.576 | 49.956 |
| 384 | 30,905.307 | 30,024.301 | 480.169 | 428.386 |

Every default-budget evaluation in that baseline was satisfied: each assigned
fraction is positive, so its sum is positive independently of reduction order.
With 1,024 bits every evaluation was indeterminate and named the size guard.
The measured implementation evaluated the
repeated sums separately; these historical measurements include report preparation
and do not isolate arithmetic phases. They showed that the product trial's roughly
one-second result was not representative of every default-valid arithmetic shape.
The synchronous report call then took tens of seconds despite individual values
fitting its size limit. The reuse results below describe the subsequent
improvement. These measurements motivated the arithmetic allowance above; neither trial
establishes a universal safe threshold or a hard deadline.

Run the script without concurrent builds or tests. Each count/budget pair uses a
fresh child, four full calls and the median of the last three. The child has a
180-second timeout and 256 MB V8 old-space allowance; these are diagnostic
controls, not library guarantees. [Samples and source hashes](../../benchmarks/explanation-cumulative-sum-review.json)
record Node 24.21.0 and 26.8.1 with identical workload construction.

### Evaluation reuse and syntax keys

Reports now reuse the completed local evaluation of identical ordered expression
syntax across hard and soft constraints within one report. Each declaration keeps
its own ID, evidence, description and soft weight. Keys are constructed iteratively
from validated, captured expressions and preserve operand order, arity, literal
representation and enum domains; model canonicalization would be unsuitable here
because reordered operands can change short-circuit failures. Only Boolean results
or failure reasons are retained, not large arithmetic intermediates. A later report
starts with a fresh cache, including when assignments or size limits change.
Repeated references to the same captured expression root first consult a local
WeakMap of completed evaluations, avoiding reconstruction of its syntax key.
Separately allocated equivalent expressions still use ordered structural keys.
Hard and soft declarations retain independent metadata in both paths. The
[shared-predicate trial](../../scripts/solver-shared-predicate-key-bench.mjs)
compares one, 32 and 128 predicates with shared versus distinct roots, using
identical output hashes. At 128 shared roots, full-report medians change from
34.680 to 31.588 ms on Node 26.8.1 and from 34.341 to 31.326 ms on Node 24.21.0.
[All samples and source hashes](../../benchmarks/shared-predicate-key-review.json)
retain the smaller and distinct-root controls, which show mixed small changes.
The fresh-child four-call trial measures complete reports, with lifetime peak
RSS and external 60-second/256 MB old-space controls. It does not establish a
general speedup or memory bound.

Variable references, enum domain names and enum values in these private keys
use compact IDs from a shared report-scoped string table. Distinct names and
values remain distinct, while long strings are no longer serialized into every
repeated reference. Literal sorts and numeric representations stay separate.
Canonical model identity and public report names retain their original strings.
These private caches are allocated inside one feasible-outcome calculation and
are absent from the returned report. Completing or failing that calculation
does not place them in a module-level cache or caller-owned object. This is an
ownership boundary, not a guarantee about when garbage collection runs. Key
construction still allocates traversal and serialized-key storage; the arithmetic
work allowance does not meter that construction.
The key builder visits each expression occurrence once, appends one syntax token
and joins the tokens once; it does not repeatedly concatenate complete subtree
keys. A shared subtree inside a new root is still visited at every occurrence.
Validation charges those occurrences before report evaluation. The pending-node
stack and token array can grow with occurrence count, while serialized numeric
literal spelling contributes its own text size. Interned strings still require
map lookups and retention for the call. These costs explain why node limits and
compact string IDs do not amount to a total key-byte or report-time ceiling.
An isolation regression compares 298 predicate shapes evaluated separately with
the same predicates combined and repeated in reverse order. Three assignment
states and two size budgets cover numeric and Boolean operators, conditional
branches, enum domains and escaped enum text, missing assignments and arithmetic
failures. Full declaration results and failure reasons must agree; this checks
reuse isolation rather than serving as an independent arithmetic oracle.

Repeating both cumulative trials after this change reduces the largest default
rational-sum report from 30,905.307 to 521.557 ms on Node 24 and from 30,024.301 to
452.886 ms on Node 26. The 24-constraint product medians fall from 955.029 to
384.226 ms and from 871.218 to 351.432 ms, respectively. The same sequential
harnesses check all evaluations at both size budgets; [all samples and source
hashes](../../benchmarks/explanation-expression-reuse-review.json) retain smaller
controls and the earlier measurements. This avoids repeated evaluations; distinct
expressions still incur their own arithmetic work. Cache keys consume memory
proportional to retained expression syntax, and reuse alone supplies neither a
general work budget nor a hard report deadline.

A [long-identifier trial](../../scripts/solver-identifier-size-bench.mjs) holds
the model at 8,194 expression nodes while increasing one repeated variable name
from 16 to 8,192 characters. Compact references reduce the largest predicate key
from 33,619,980 to 61,452 UTF-16 code units. Median full-report times at that size
change from 216.216 to 184.648 ms on Node 24 and 147.158 to 109.971 ms on Node 26.
Both predicates remain satisfied with `maxExplanationWork: 1`, confirming that
this Boolean/key-construction workload lies outside arithmetic accounting.
Each case uses a fresh child, four calls and the median of the last three,
run sequentially without concurrent builds or tests. The child has a 60-second
timeout and 256 MB V8 old-space allowance, neither a library resource guarantee.
[Before/after samples and source hashes](../../benchmarks/explanation-identifier-size-review.json)
also record lifetime peak RSS, which includes construction and all calls and
does not consistently fall. Canonical serialization still repeats authored
identifiers, so compact evaluation keys do not bound total report memory.

A complementary [enum-key trial](../../scripts/solver-enum-key-bench.mjs) uses
6,146 expression nodes with repeated enum domain names and values of 16, 1,024
and 8,192 characters each. Interning reduces its largest predicate key from
33,608,716 to 50,188 UTF-16 code units. Largest-case full-report medians change
from 237.568 to 165.184 ms on Node 24 and 158.627 to 108.468 ms on Node 26.
It uses the same sequential four-call/fresh-child controls as the variable-name
trial and remains satisfied with `maxExplanationWork: 1`. The
[enum samples and source hashes](../../benchmarks/explanation-enum-key-review.json)
retain all sizes and peak RSS; those process-memory observations again do not
consistently improve. Canonical enum strings and other report phases remain
outside the compact-key optimization and arithmetic counter.

A [current-runtime checkpoint](../../benchmarks/explanation-key-current-review.json)
reruns both unchanged trials sequentially on Node 24.21.0 and 26.8.1. Across all
three name lengths, variable keys stay at 61,452 code units and enum keys at
50,188. At 8,192 characters, full-report medians are 123.534/76.417 ms for
variables and 114.761/74.242 ms for enums (Node 24/26). These timings include
capture, validation, identity and report construction; they do not isolate key
construction. The record retains all sizes, samples, lifetime peak RSS and
current solver source hashes. Model validation counts shared expression
occurrences toward `maxExpressionNodes`, but text length and intermediate key
storage are not an overall byte cap. A report-level regression doubles one
shared Boolean leaf through eight conjunction levels and uses that graph twice:
nine distinct objects represent 1,022 expression occurrences. A 1,021-node
limit rejects; 1,022 permits retry. Changing the shared leaf then produces fresh
evaluations without changing the earlier report or replacing the caller graph. No additional optimization is inferred
from this checkpoint alone.

A separate [exponent-padding trial](../../scripts/solver-exponent-padding-bench.mjs)
keeps a three-node predicate at exactly four budgeted numeric digits while
padding the exponent of one real literal with 1, 1,024 or 65,536 zeros. Its key
grows from 60 to 1,083 to 65,595 UTF-16 code units because numeric spelling is
preserved in syntax identity. Each model rejects a three-digit allowance,
passes four, and produces the same complete report hash. Largest-case report
medians are 1.407 ms on Node 24.21.0 and 1.450 ms on Node 26.8.1.
[All samples and source hashes](../../benchmarks/exponent-padding-review.json)
record sequential fresh children, four reports per case and the median after
discarding the first. Peak RSS includes construction, key measurement and
validation; external 60-second/256 MB controls are not library limits. This
isolates another text-size dimension outside the numeric expansion budget;
applications accepting arbitrary model text must apply their own input-size
limits when required.


### Canonical serialization costs

Digest-only operations now hash batches from the canonical token stream instead
of assembling the full canonical JSON string first. `Canonical.serialize` still
returns the same complete string; `Canonical.digest` and report identity hash
the same UTF-8 bytes and preserve validation before/after public input capture.
Batches flush at 65,536 UTF-16 code units without splitting tokens, so an
individual larger token can exceed that threshold. Canonical model preparation
and individual string tokens remain separate allocation costs.

Repeating the enum trial after this change reduces the largest median full-report
time from 168.384 to 146.083 ms on Node 24 and 115.340 to 90.960 ms on Node 26.
Lifetime peak RSS changes from 497,216 to 118,672 KiB and 440,896 to 123,296 KiB,
respectively. The 16-character control is slightly slower (26.126 to 26.378 ms
and 21.381 to 23.861 ms); streaming is a tradeoff, not a universal timing win.
[Streaming samples and source hashes](../../benchmarks/explanation-streamed-digest-review.json)
use the same sequential fresh-child controls and include all sizes. Peak RSS
includes fixture construction and all calls; these observations establish no
general process-memory ceiling. Digest-equivalence tests compare public and
report hashes with the serialized UTF-8 hash across batch sizes, Unicode and
escaped enum values.

Full serialization now joins the same batches instead of retaining a separate
array entry for every JSON token. It still allocates the complete output string.
A [serialization trial](../../scripts/solver-canonical-serialization-bench.mjs)
uses 5,000 constraints, each containing ten Boolean literals (55,000 expression
nodes), and produces 2,604,001 identical UTF-8 bytes before and after batching.
Median serialization time changes from 242.430 to 225.194 ms on Node 24 and
205.307 to 186.834 ms on Node 26. Lifetime peak RSS changes from 324,720 to
256,992 KiB and 240,528 to 205,568 KiB, respectively. These are sequential fresh
processes with four calls each, the first excluded from the timing median;
fixture construction and result checks are outside the timer but included in
process memory. The [samples](../../benchmarks/canonical-serialization-batch-review.json)
cover this flat Boolean workload only, with a 256 MiB V8 old-space setting,
which is not a process-memory limit. They do not establish improvements for
all model sizes or remove canonical preparation and complete-output costs.

Canonical preparation also reuses already converted expression objects across
hard constraints, soft constraints and objectives within one captured model.
Validation still counts every occurrence, and separate public calls start fresh.
This helps shared input graphs; structurally equal but distinct objects are not
merged. Repeating the serialization trial, whose 5,000 constraints reference one
shared expression, changes median time from 223.263 to 80.950 ms on Node 24 and
195.311 to 77.190 ms on Node 26. Lifetime peak RSS changes from 261,040 to
190,624 KiB and 211,584 to 193,328 KiB. The same bytes and hash are retained.
[Preparation-reuse samples](../../benchmarks/canonical-preparation-sharing-review.json)
use the same four-call sequential fresh-process controls. The result applies to
this shared graph and does not establish a speedup for unshared models or reduce
the occurrence-based validation and output-size costs.

An unshared control expands that same graph through JSON before timing. Median
serialization changes from 316.707 to 333.161 ms on Node 24 and 268.574 to
281.136 ms on Node 26: roughly 5% slower in this trial. Lifetime peak RSS is
slightly lower, 295,008 to 290,384 KiB and 232,320 to 228,608 KiB. Bytes and
hash remain identical. This records the broader cache's tradeoff on an input
where no cross-constraint reuse is available. The
[unshared samples](../../benchmarks/canonical-preparation-unshared-review.json)
use the same sequential fresh-process/four-call controls, including fixture
expansion in lifetime RSS but outside timing. Reproduce the current variant
with `node --max-old-space-size=256 scripts/solver-canonical-serialization-bench.mjs 5000 unshared`
from the repository root; omit `unshared` for the original shared fixture.

### Cumulative work calibration

An [experimental work-policy probe](../../scripts/explanation-work-policy-probe.mjs)
changes each sum predicate's nonpositive comparison threshold, so complete
expression reuse cannot avoid the arithmetic. Its diagnostic instrumentation
charges the maximum estimated bit bound at each successful size check. Rejected
charges leave the remaining allowance available for cheaper later operations.
On both Node majors the unconstrained diagnostic records 260,443,664 units for
384 satisfied predicates. Candidate allowances produce identical counts:

| Diagnostic allowance | Satisfied | Indeterminate | Node 24 elapsed ms | Node 26 elapsed ms |
|---|---:|---:|---:|---:|
| Unconstrained control | 384 | 0 | 32,293.967 | 30,979.379 |
| 1,000,000 units | 1 | 383 | 537.501 | 506.233 |
| 10,000,000 units | 14 | 370 | 1,644.109 | 1,566.633 |

These are single instrumented full calls, not warmed medians or deadlines.
The probe predates the public work limit. It now explicitly disables that limit
while temporarily intercepting guards in isolated children to reproduce the
original experimental accounting; its diagnostic allowance is not report metadata. The backend result remains satisfied while affected local
evaluations become indeterminate. [Raw observations and source hashes](../../benchmarks/explanation-work-policy-review.json)
retain the accounting totals and 120-second/256 MB child controls. This established the deterministic accounting mechanism now used by the runtime.
A [calibration harness](../../scripts/explanation-work-calibration.mjs) then ran ten
existing workload invocations with unchanged correctness assertions, including
4,096-factor flat products, shared product/negation/division/addition variants,
near-budget constant sums, nine intermediate-growth cases and the repeated-sum
report. Both Node versions record identical charges with no rejected control at
10,000,000 units; the largest uses 8,851,156. This preserves those useful controls
while limiting the distinct-sum workload. [Raw calibration results](../../benchmarks/explanation-work-calibration-review.json)
retain every charge count and source hash. Disproportionate arithmetic costs and
the uncharged preparation/formatting phases remain separate resource boundaries.

The shipped guard passes the same calibration assertions on both supported Node
versions. Running the distinct-predicate probe with `--native-case 10000000`
uses the public limit without intercepting guards: 14 evaluations finish and
370 become indeterminate, with single full-call observations of 1,782.066 ms
on Node 24 and 1,605.410 ms on Node 26. [Native results and calibration reruns](../../benchmarks/explanation-work-limit-review.json)
record the implementation hashes. These are workload observations, not a promise
that every model finishes within two seconds.

### Preflight and captured inputs

Variable, combined hard/soft constraint, and objective counts are checked from
array lengths before declaration entries are read. Enum-value counts accumulate
by domain and stop before reading the members of a domain that exceeds the
budget. For an oversized model these count errors take precedence over errors
inside the declarations. Declaration count errors report the full array count;
enum-value errors report the cumulative count through the first oversized domain.
Expression node/depth limits are checked while traversing, before inspecting
an over-budget node, rather than after walking the whole expression. The
reported `actual` count is the first exceeded boundary; traversal stops there.
Validation uses an explicit traversal stack, so raised depth limits do not rely
on JavaScript recursion. Shared subexpressions count at every occurrence and
retain their separate diagnostic paths.
Capability discovery also uses an explicit traversal stack. Within each root
expression it visits shared nodes once and computes variable dependence from
completed children, avoiding repeated subtree scans for nonlinear arithmetic.
A variable-bearing expression used twice in a product still counts as two
factors. Cyclic expressions supplied directly to capability discovery throw
`TypeError`; normal solve entry points validate models first.

Runtime options must be objects containing only `limits` and `unsatCore`;
`unsatCore`, when supplied, must be Boolean. Limit overrides must be an object
with known limit names and positive safe integer values. Unknown keys and
malformed values throw `TypeError` before backend execution, preventing spelling
mistakes from silently selecting defaults. Sensitivity's `operation` accepts
only `feasibility` or `optimization` (omission defaults to optimization);
invalid modes throw `WorkflowValidationError` before solving. Invalid limit
objects and functions are described by type without invoking caller-defined
string conversion, so diagnostic formatting cannot hide the named limit error.
Sensitivity's `maxRuns` diagnostic follows the same rule for malformed objects
that survive request copying, and validation rejects them before backend execution.
Sensitivity requests must be objects with an array of samples. Missing, null,
string and array-like sample containers produce named workflow validation errors;
an empty array retains the separate requirement for at least one sample.
Optional `fixed` and `observe` fields must also be arrays when supplied; null,
strings and array-like objects are rejected before solving. Omit them or use
empty arrays when no fixed bindings or observed variables are needed.
Sample values and fixed-binding entries must be objects. Null, missing or sparse
entries produce validation errors naming the variable or fixed-binding index
before any backend call; array holes are not silently skipped.
Boolean samples and fixed values require literal `true` or `false`; missing
values, strings, numbers and objects are rejected with the variable name.
Every sample is validated before the first run, so an invalid later Boolean
sample cannot trigger backend work for earlier samples.

Solver and workflow entry points capture the supplied `unsatCore` and `limits`
fields once before defaults and submission. A changing option getter cannot
change the core request or replace the limits object between validation and
execution. The limit resolver reads each declared override once, including
inherited and non-enumerable properties, then fills absent fields with defaults.
Explicit `undefined` and invalid inherited values are rejected. Workflows retain
the resolved limits before copying their inputs, so those overrides survive
submission to the adapter.

`Solve.run` and `Solve.runWithExplanation` copy the model first, then validate
and deeply freeze that same copy before invoking the adapter. Changing getters
cannot substitute different model fields between validation and submission.
Later caller edits cannot change the submitted model, and adapters must treat
it and the resolved limits as read-only. The caller's own objects remain editable.

Portable record/array copies use an explicit work queue, preserving shared
references without relying on native clone recursion. This also applies to
workflow inputs and explanation context. Data outside those portable containers
is delegated to native structured cloning.
Descriptor inspection selects the native path for accessor properties and
proxies before copying begins. This preserves native getter count/order and
proxy rejection; the iterative path handles portable data properties.
Native fallback applies to the whole input graph, not just the accessor or special
container that selected it. Deep graphs on that path can therefore fail with a
native `RangeError` even when their ordinary-data counterparts copy iteratively.
A 20,000-level regression on both supported Node majors verifies the failure,
one accessor read and a fresh detached copy after replacing the accessor with a
data property. This is a tested fixture, not a portable native depth threshold;
raising model depth limits does not raise the native cloning stack limit.
Getter mutations follow native cloning semantics, including changes to later
properties and shared objects. Capture does not roll back those caller-side
effects if a getter throws. The original thrown value propagates; a corrected
retry starts a fresh copy rather than reusing a partially captured graph.

### Canonical model identity

`Canonical.serialize` produces stable semantic JSON. Declaration order is
ignored except for objectives, and exact values are reduced to normalized
fractions. Descriptions and evidence row IDs do not affect identity.
`Canonical.digest` returns the full `sha256:<hex>` digest.
Both `Canonical.serialize(model, limits?)` and `Canonical.digest(model, limits?)`
accept optional validation limits. Limits control acceptance, not identity:
the same model has the same serialization and digest under different sufficient
limits. Explanations and workflow reports carry their configured limits through
hashing and replay checks, so a model accepted with raised limits is not rejected
later by the hashing defaults.
Expression conversion and canonical JSON rendering use explicit stacks.
Commutative operands are ordered by a lazy comparison of their canonical text,
avoiding eager rendering of whole subtrees for each comparison. These traversal
changes preserve the canonical format and existing model digests.

## Adapter results

An adapter advertises a backend name/version and a capability set. `Solve.run`
validates the model, merges limits, checks capabilities deterministically, and
only then invokes it. Results are disjoint:

- `satisfied` includes a concrete assignment;
- `optimal` includes assignments, objective values, available bounds, and an
  explicit proof marker;
- `unsatisfied` is allowed only for proved infeasibility and may include a
  stable constraint-ID core; and
- `unknown` carries a structured timeout, resource, cancellation, backend, or
  indeterminate reason.

`Solve.run`, `Solve.runWithExplanation`, and direct `Explain.report` calls
capture the returned result before checking its status. `optimal` requires
literal `optimalityProved: true`; `unsatisfied` requires literal
`infeasibilityProved: true`. Missing, false, or coerced markers and unsupported
statuses throw `TypeError` instead of producing a proved outcome. A changing
getter cannot pass validation and then replace the proof marker in the returned
snapshot. `Solve.run` returns an owned copy without mutating the adapter's data.
These checks enforce the adapter's assertion contract; the adapter remains
responsible for the correctness of its proof assertions and other result fields.
Result rejection is local to that call: a later solve invokes the adapter again
and validates its newly returned result. If the adapter returns corrected
metadata, the same adapter object can be reused. Later changes to its diagnostic
objects do not alter a previously captured result or report. If an accessor
throws during result capture, that original thrown value propagates before
metadata validation. Correcting the same caller-owned result allows a later
solve or report call to retry; capture does not retain a partial result. The
regression covers all three result boundaries and both Error and unprintable
thrown values, including detached diagnostics after successful retry.

Workflow operations use the same checks before normalizing outcomes. In
particular, feasibility may present a proved `optimal` result as `satisfied`,
but an optimal result without its proof marker is rejected before that
conversion. Optimization retains the validated optimal status and marker.

A feasible assignment returned after an optimization timeout is `unknown`,
not `optimal`. A timeout or unsupported capability is never rendered as proof
that the model is infeasible.

## Provenance and explanations

Topics in this section:

- [Declaration provenance](#declaration-provenance)
- [Report fields and diagnostic text](#report-fields-and-diagnostic-text)
- [Local constraint evaluation](#local-constraint-evaluation)
- [Captured reports and input JSON](#captured-reports-and-input-json)
- [Workflow context capture](#workflow-context-capture)
- [Rendering an explanation](#rendering-an-explanation)
- [Binding and snapshot validation](#binding-and-snapshot-validation)
- [Shared-expression evaluation trial](#shared-expression-evaluation-trial)

### Declaration provenance

Variables, constraints, soft constraints, and objectives may carry a stable
declaration URI/line/column, exact CAVE evidence row IDs, and scenario input
IDs. These fields and human descriptions never affect the canonical model
digest.

Descriptions on enum domains, variables, hard/soft constraints and objectives
must be strings when supplied; empty descriptions are valid. They remain
non-semantic labels and do not affect identity. Checking their runtime types
before solving prevents malformed labels from reaching explanation records.

Declaration locations must be objects with a nonblank string URI and optional
positive safe-integer line and column numbers. Either position may be omitted.
The text explanation uses `source.cave:7:3` when both are present and
`source.cave (column 3)` when only a column is known, preserving the supplied
location without inventing a line number. Evidence and scenario input IDs
must be dense arrays of unique, nonblank strings; empty arrays are valid.
Malformed provenance produces `Validate.ModelValidationError` with the field
path before backend execution, including sparse arrays and incorrect runtime
types supplied by JavaScript callers.

### Report fields and diagnostic text

`Solve.runWithExplanation` wraps any adapter result in versioned, plain JSON.
`Explain.render` produces deterministic plain text with labeled lines and a final
newline. Treat it as text when embedding it in a webpage or another document;
that destination supplies its own HTML or Markdown escaping. The renderer expects
a typed report produced by the explanation APIs. Its defensive backend-value
and input-JSON checks are specific checks, not a general validator for arbitrary
caller-edited report structures. It builds the complete output string in memory;
input JSON sharing, diagnostic length and declaration count affect output size.
The text view quotes fields containing C0/C1 controls, DEL or Unicode
line/paragraph separators. This applies to backend metadata, snapshot/scenario
text, input queries and IDs, declaration URIs, evidence references and backend
assignment/objective/core IDs, as well as values and reasons. Nested input JSON
escapes these characters while remaining JSON. Ordinary text keeps its existing
display, and rendering does not modify the structured report.
The report records the canonical digest, backend/version, resolved limits,
diagnostics, optional frozen snapshot and authored inputs, assignments,
evaluated hard and soft constraints, objective contributions, or a mapped
unsatisfiable core. Cores are explicitly not promised minimal and `unknown`
keeps its structured reason.
Unknown outcomes require an object reason with kind `timeout`, `resource-limit`,
`cancelled`, `backend-error`, or `indeterminate`, and a string message (which may
be empty). An optional `limit` must name a supported solver limit. Solve and
explanation boundaries enforce this after capturing the adapter result.
In text rendering, unknown-reason messages containing control characters or
Unicode line separators appear as quoted, escaped JSON strings on the same
`Unknown:` line. Ordinary single-line messages retain their existing display.
The structured report preserves the original message for inspection.
The renderer reuses the 35 fixed escapes for DEL, C1 controls and Unicode
line/paragraph separators. In a one-million-character U+0085 message, this
reduces the measured render median from 97.1 to 34.2 ms on Node 26 and 99.7 to
39.8 ms on Node 24, with identical output. Escaping still expands that message
to six characters per input character plus quotes. Numeric solver limits do
not bound diagnostic text length, and rendering has no independent text budget.
Run `node scripts/solver-diagnostic-render-bench.mjs` alone to reproduce plain
and control-heavy cases; [saved measurements](../../benchmarks/diagnostic-render-review.json)
include all samples, exact-output checks and source fingerprints. Peak RSS
includes fixture construction, expected output and assertions, so it is not an
isolated renderer allocation measurement. Small plain-text controls vary; these
results do not establish a universal speedup or process-memory bound.
`Validate.unknownReason(value)` exposes the same non-mutating check for callers;
it throws `TypeError` for malformed reasons and does not capture caller data.
Result metadata also requires non-empty backend name/version strings, finite
non-negative `elapsedMs` (fractional milliseconds are valid), and a dense array
of diagnostic objects. Each diagnostic has level `info`, `warning`, or `error`
and string code/message fields, which may be empty. `Validate.resultMetadata`
exposes this non-mutating check without capturing caller data. Solver result
boundaries apply it after capture, before returning an outcome or explanation.
`Validate.explanationContext(context)` exposes the same context checks used by
`Explain.report`: scenario identity fields, snapshot policy values, input identity
and provenance, and portable input JSON. It validates without capturing or
mutating caller data; callers needing an owned report should use `Explain.report`.
### Local constraint evaluation

Comparisons of constant numeric expressions with literal zero first attempt a
conservative sign proof, avoiding unnecessary exact sums when their sign is
known. Uncertain or undefined expressions retain ordinary evaluation.
Hard and soft constraint evaluation uses an explicit stack, preserving Boolean
short-circuiting and selected conditional branches. Deep valid expressions can
be evaluated under raised model limits without becoming `indeterminate` from
call-stack exhaustion. Missing assignments or undefined selected arithmetic
still produce `indeterminate` evaluation. Indeterminate hard and soft constraints
include an optional `evaluationReason` describing the local failure, such as a
missing assignment, invalid value, or division by zero. `Explain.render` displays
that reason as a quoted, escaped string,
including escaped C1 controls and Unicode line/paragraph separators, so those
characters cannot split the constraint's diagnostic line. Structured reasons
retain their original contents. Reasons are human-readable diagnostics,
not stable error codes; older reports may omit them. Determinate and skipped
branches have no reason, and the backend status remains unchanged.
Text rendering labels malformed assignment and objective value shapes as
`(invalid backend value)` rather than failing on null values or coercing an
invalid Boolean into plausible output. Original values remain in the structured
report for inspection. This rendering check concerns value shape; it does not
verify numeric validity or backend outcomes. Constraint evaluation separately
checks accessed assignments against the model.
Integer, rational and enum display strings containing control characters or
Unicode line separators are quoted and escaped on their assignment/objective
line. This includes multiline enum labels as well as malformed numeric text;
the structured values remain unchanged. Ordinary single-line values keep their
existing display.
Backend boolean assignments must carry
primitive booleans: strings such as `"false"`, numbers and objects produce
indeterminate hard/soft evaluations when accessed, instead of JavaScript truthiness.
Enum variables require assignments with string domain/value fields that match
the variable's declared domain and name one of its values. A malformed or out-of-domain
assignment likewise makes hard/soft evaluation indeterminate when accessed.
Accessed assignments must also match the declared variable kind: boolean,
numeric or enum. Integer variables require an integral normalized value. Exact
integer and rational representations remain interchangeable when the value
belongs to that numeric kind (for example, `2/2` is integral). Wrong-kind or
fractional integer assignments make local hard/soft evaluations indeterminate.
Numeric assignments must also satisfy any declared minimum and maximum,
compared exactly and inclusively. Omitted real bounds impose no restriction on
that side. An out-of-range accessed value makes local evaluations indeterminate.
Assignment normalization and validation, including failed validation, are cached
for one report so repeated hard/soft constraints reuse the same result.
Boolean short-circuiting and conditional branch selection still skip unused
assignments, even if another constraint has already cached their failure.
A fresh report validates its own assignment, so a corrected value can recover.
The report retains the backend status and original assignment for inspection;
these local evaluations do not reclassify the adapter result.

### Captured reports and input JSON

Direct `Explain.report` calls capture and validate limits once, so model
validation and the completed report use the same values even when limits are
supplied through changing getters. They copy the model before deriving its digest or
evaluating constraints. Numeric validation and outcome evaluation therefore use
the same captured literals even when caller properties are changing getters.
They also validate the captured explanation context,
so getters that change during copying cannot insert non-JSON input values into
a completed report.
Declared context fields remain included when inherited or non-enumerable.
Text rendering likewise captures and revalidates input JSON before serialization,
so a nested getter cannot introduce a non-finite number after validation and
have it printed as `null`. Custom JSON serializers remain rejected.
Input JSON validation and serialization use explicit stacks. Shared acyclic
objects remain shared in the captured report, but JSON text repeats them at each
occurrence: a 12-level binary graph containing only 13 distinct objects renders
4,096 leaf occurrences. Avoid treating distinct-object count as an output-size
bound; model numeric limits do not bound this expansion. Cycles reject before
serialization, and repairing a cycle in a caller-edited report permits a fresh
render without a stale traversal cache. Failed rendering leaves that report
unchanged. These rules apply to both `value` and `authoredValue` input fields.
`Explain.report` captures the backend result before inspecting it, so assignment
values shown in the report and used to evaluate hard/soft constraints come from
the same data even when a programmatic backend supplies changing getters.
Completed explanation reports own copies of their backend metadata,
diagnostics, assignment and objective values, limits, context and declaration
evidence. Changing the original objects afterward cannot rewrite an existing
report. This also applies to direct `Explain.report` calls; the copy does not
freeze or mutate caller-owned data.

### Workflow context capture

The explanation context is copied before backend execution as well, preserving
the submitted descriptions and evidence when callers edit their inputs during
an asynchronous solve. A mismatched `context.modelDigest` fails before the
backend runs.
The workflow entry points copy model, options and context before scope analysis
and solving. Feasibility, optimization, counterexample and sensitivity therefore
analyze and execute the same captured model, including when supplied fields
are getters.
Sensitivity additionally copies its full request once, so changes to samples,
the selected variable, limits, or evidence during one backend call cannot alter
later steps. Replay digests are checked before any workflow backend call.

### Rendering an explanation

```ts
const report = await Solve.runWithExplanation(adapter, model, {
  unsatCore: true,
  limits: { timeoutMs: 2_000 }
}, {
  snapshot: { transactionTime: '019c…', validTime: '2026-08-01' },
  inputs: [{
    id: 'team-size',
    query: 'system HAS team-size: ?n',
    value: { kind: 'integer', value: '12', unit: 'people' },
    authoredValue: '0.012K people',
    evidenceRowIds: ['019c…'],
    scenarioClaimIds: []
  }]
})

process.stdout.write(Explain.render(report))
```

The renderer is a deterministic human view over the same JSON report. Neither
building nor rendering an explanation writes to the CAVE store.
Input values and authored values serialize iteratively, so deeply nested valid
JSON can render on every supported Node version without relying on the native
JSON serializer's recursion limit. Object-key order, string escaping, array
order, and omission of undefined object properties follow ordinary JSON output.
Input lines retain both normalized and authored values when present, followed
by the binding query and sorted evidence-row/scenario-claim references. A
missing value is shown as `(no value)`; an explicit JSON `null` remains `null`.
### Binding and snapshot validation

Explanation bindings require a dense input array with unique nonempty string
IDs, optional string queries, and dense arrays of nonempty evidence-row and
scenario-claim IDs. Malformed bindings throw `TypeError` when building a report
and before backend execution in explanation/workflow calls. These checks
validate identity and list shape; external IDs are not resolved against a store.
Normalized and authored values must contain finite JSON primitives, dense
arrays, or plain objects. Cycles, custom JSON serializers, and non-JSON values
are rejected before solving. Shared objects are allowed, as are undefined
optional object properties (omitted by JSON serialization). Undefined array
members are rejected because JSON would silently change them to null.
Snapshot metadata requires a nonempty transaction-time string or explicit null,
an optional nonempty valid-time string, supported alias/resolution policies,
and a finite minimum confidence in `[0, 1]`. Scenario IDs and input/overlay
digests must be nonempty strings. These metadata checks also run before solving;
time labels and external digests remain opaque and are not verified against a
store. The model digest retains its separate exact replay-identity check.
Text output includes supplied snapshot alias/resolution policies and minimum
confidence, plus both scenario input and overlay digests. Different evidence
scopes therefore remain distinguishable in the human report; omitted policies
are not replaced with assumed defaults.

### Shared-expression evaluation trial

`node scripts/explanation-sharing-bench.mjs` compares complete explanation reports
for shared addition graphs and equivalent expanded trees at depths 8, 10 and 12.
Every repeated operand still contributes to the result. Each fixture runs in an
isolated child with five timed calls; fixture construction and assertions are
excluded, while model copying, validation, digest generation and evaluation are
included. The report records its 10-second child timeout, 128 MB V8 old-space
setting and post-workload RSS, which is not peak memory or a process memory cap.

Sequential darwin-arm64 observations on 2026-09-09 measured depth-12 shared/tree
medians of 13.926/87.623 ms on Node 24.21.0 and 15.088/78.198 ms on Node 26.8.1.
[Full samples](../../benchmarks/explanation-sharing-review.json) retain all sizes.
These full-pipeline observations do not isolate arithmetic evaluation or prove a
benefit from adding an evaluator cache. Evaluation currently revisits shared
nodes; retaining computed values would also have a memory cost. Assignment
isolation, operand multiplicity and short-circuit behavior have an integration
regression and must remain intact under any future caching change.

## Backend evaluations

Z3 is the only shipped adapter. The [MiniZinc](MINIZINC-EVALUATION.md) and
[direct HiGHS](HIGHS-EVALUATION.md) evaluations record why neither candidate
currently crosses the portable boundary. MiniZinc lacks a motivating
solver-neutral finite-domain schema. HiGHS materially outperforms Z3 on
representative LP/MIP workloads and is much smaller, but its synchronous
binary64 wrapper cannot yet honor CAVE's exact-result, cancellation, and
working-memory contracts.

## Verification workflows

`Workflow` gives feasibility, optimization, counterexample, and bounded
sensitivity distinct public semantics while keeping one validated model,
snapshot context, adapter limits, and result vocabulary.

```ts
import { Workflow } from '@cavelang/solver'

const feasible = await Workflow.feasibility(adapter, model, {
  limits: { timeoutMs: 2_000 }
}, context)

const best = await Workflow.optimization(adapter, model, {}, context)
const witness = await Workflow.counterexample(
  adapter, model, 'declared-invariant-id', {}, context
)
const boundary = await Workflow.sensitivity(adapter, model, {
  variableId: 'team-size',
  samples: [
    { sort: 'int', value: '4' },
    { sort: 'int', value: '8' },
    { sort: 'int', value: '12' }
  ],
  observe: ['architecture'],
  operation: 'optimization',
  maxRuns: 3
}, {}, context)
```

Workflows require every real variable to have explicit lower and upper bounds.
Reported scope theories describe the authored model using capability analysis,
including literals, division, enum domains, and rational soft weights as well as
variable declarations. A model can require exact rational arithmetic without
declaring a real variable. Scope domains still list declared variables only.
Sensitivity accepts an explicit, typed sample list and refuses more than
`maxRuns` checks. Its report includes adjacent result transitions and
contiguous `unknown` regions rather than interpolating across timeouts.
Samples are normalized before duplicate detection: object property order and
extra fields do not distinguish Boolean or enum values, just as different
equivalent numeric spellings do not distinguish exact numbers. Duplicate samples
are rejected before backend execution. Reported sample and fixed values contain
only their normalized value fields.

The [sensitivity batch benchmark](../../scripts/sensitivity-batch-bench.mjs)
measures complete workflow overhead with an immediate `unknown` adapter: it
includes preflight, per-run validation and report construction, but no solver
search. Initial macOS arm64 runs on 2026-09-09, before explanation-digest reuse,
produced these median times
for 64 integer samples (one warmup, five measured calls):

| Authored constraints | Node 24.21.0 | Node 26.8.1 |
|---|---:|---:|
| 0 | 6.84 ms | 6.58 ms |
| 100 | 188.74 ms | 180.01 ms |
| 1,000 | 1,895.71 ms | 1,731.70 ms |

The fixture repeats simple integer lower-bound constraints; these timings do
not predict a real backend's search time or isolate the added preflight cost.
A two-sample request whose later generated model exceeds its digit budget
rejects before any backend call: medians were 6.72 ms and 6.13 ms with 1,000
constraints. [Full samples and runtime metadata](../../benchmarks/sensitivity-batch-runtime-review.json)
also include one- and sixteen-sample batches. Batch size and model size both
matter even when the backend returns immediately.

Profiling identified repeated copying and canonical serialization. Workflow
reports now reuse the source-model digest already computed by their explanation;
the sensitivity summary reuses its first point's digest. This retains per-sample
preflight and backend validation. Repeating the same benchmark reduced the
64-sample, 1,000-constraint median to 1,289.74 ms on Node 24.21.0 and 1,207.02 ms
on Node 26.8.1, about 32% and 30% below the initial measurements. The
[comparison and raw samples](../../benchmarks/workflow-digest-reuse-review.json)
retain both runtime results and link the baseline. Actual solver-search costs
remain outside this measurement.

Backend model choices are made deterministic with lexicographic objectives in
stable variable-ID order: false before true, smaller exact numbers first, and
enum values in lexical order. In optimization, authored objectives retain
their declared order, explicitly weighted soft constraints follow, and the
tie-break objectives come last. These generated objectives count against
`maxObjectives`; the workflow fails preflight rather than silently dropping
determinism. A merely feasible backend result is never promoted to `optimal`.

Counterexample checks replace one declared invariant with its negation. A
model is a concrete witness; an unsatisfied result means only that the
invariant holds within the report's named assumptions, bounded domains, and
declared Boolean/integer/rational/enum theories. `unknown` remains unknown.


## Zero rational normalization trial

`Exact.rational({ numerator: '0', denominator })` validates an integer-string
denominator and checks it contains a nonzero digit before returning `0/1`.
It avoids constructing the denominator BigInt for this case. Signed integers
and leading zeros remain supported; malformed strings and zero denominators
still throw. Numeric denominators retain safe-integer validation.

Run `node scripts/exact-zero-bench.mjs` alone. It compares zero and unit
numerators over denominators of 1,000, 100,000 and 1,000,000 decimal digits.
Each median uses five calls after one warm-up, with string construction and
result assertions outside timing. The unit numerator exercises the unchanged
nonzero path. On macOS arm64, the before/after medians were:

| Denominator digits | Numerator | Node 24.16.0 before → after | Node 26.5.0 before → after |
|---|---|---|---|
| 1,000 | 0 | 0.006 → 0.003 ms | 0.007 → 0.003 ms |
| 100,000 | 0 | 2.115 → 0.068 ms | 2.192 → 0.041 ms |
| 1,000,000 | 0 | 29.715 → 0.637 ms | 30.191 → 0.389 ms |
| 1,000 | 1 | 0.014 → 0.015 ms | 0.013 → 0.012 ms |
| 100,000 | 1 | 6.404 → 6.422 ms | 7.199 → 6.392 ms |
| 1,000,000 | 1 | 101.009 → 101.836 ms | 99.966 → 101.443 ms |

The zero path still scans the supplied text, and this optimization does not
bound input size, nonzero normalization, or general intermediate arithmetic.
The trial establishes the measured special-case improvement on these runtimes;
small timing differences in the nonzero control do not establish a speedup.


## Unit denominator normalization trial

For object rationals with an integer-string numerator and a denominator equal
to `1` or `-1`, `Exact.rational` validates the integer text and normalizes its
sign and leading zeros directly. The numerator avoids a BigInt round trip;
negative denominators reverse the sign, and every zero representation remains
`0/1`. Both operands retain validation, including safe-integer numeric inputs.
The zero/string-denominator shortcut described above remains in place.

Run `node scripts/exact-unit-denominator-bench.mjs` alone. The numerator is a
power of ten with a leading plus and zeros, across 1,000/100,000/1,000,000 digits.
Denominators `1` and `-1` exercise the shortcut; `3` controls for general
normalization. Each median uses five calls after warm-up, with construction and
result assertions outside timing. On macOS arm64:

| Numerator digits | Denominator | Node 24.16.0 before → after | Node 26.5.0 before → after |
|---|---|---|---|
| 1,000 | 1 | 0.013 → 0.005 ms | 0.013 → 0.003 ms |
| 1,000 | -1 | 0.014 → 0.003 ms | 0.013 → 0.003 ms |
| 1,000 | 3 | 0.010 → 0.012 ms | 0.010 → 0.012 ms |
| 100,000 | 1 | 6.495 → 0.069 ms | 6.294 → 0.041 ms |
| 100,000 | -1 | 6.494 → 0.068 ms | 6.307 → 0.041 ms |
| 100,000 | 3 | 6.530 → 6.615 ms | 6.351 → 6.446 ms |
| 1,000,000 | 1 | 101.889 → 0.682 ms | 101.306 → 0.390 ms |
| 1,000,000 | -1 | 102.394 → 0.685 ms | 101.498 → 0.394 ms |
| 1,000,000 | 3 | 101.627 → 103.681 ms | 100.656 → 103.088 ms |

Input validation still scans text. This special case does not bound input size,
non-unit normalization or intermediate arithmetic. The general-path control
shows no speedup and slightly higher timings in these sequential runs; it is
included to keep the optimization's scope visible.


## Integer decimal expansion trial

Exact decimals whose exponent moves the decimal point past all fractional
coefficient digits now normalize directly as integer text. Leading zeros and
signs normalize before appending zeros; zero returns `0/1` after exponent
validation. Trailing coefficient zeros now cancel against positive scales in
text before bigint construction: `1.00` returns `1/1` directly, and `0.125000`
reduces the smaller `125/1000`. Remaining positive scales use BigInt reduction.

Run `node scripts/exact-decimal-zero-bench.mjs` alone to measure this cancellation.
It checks complete results outside timing and reports five-call medians after
warm-up for 1,000, 10,000 and 100,000 trailing zeros. On macOS arm64, the
100,000-zero inputs measured as follows:

| Prefix before trailing zeros | Node 24.21.0 before → after | Node 26.8.1 before → after |
|---|---:|---:|
| `1.` | 3.453 → 0.310 ms | 3.442 → 0.292 ms |
| `-0.125` | 3.915 → 0.297 ms | 3.868 → 0.277 ms |

This avoids unnecessary large operands for reducible decimal spellings; it does
not cap standalone arithmetic work or alter the model validation budget.

`python3 scripts/exact-decimal-oracle.py` independently checks 1,504 decimal
spellings against Python's `fractions.Fraction`, using seed 2301, signed
coefficients, exponents from −100 to 100 and trailing-zero suffixes up to 2,048
digits. It uses the Node executable on `PATH`; all cases pass on Node 24.21.0
and 26.8.1. This checks exact values, not a timing threshold or general work cap.

Run `node scripts/exact-integer-decimal-bench.mjs` alone. Inputs are `+001.25eN`
and `+001.25e-N`; negative exponents control for fractional reduction. Each
median uses five calls after one warm-up, with complete expected-result
assertions outside timing. Sequential runs on macOS arm64 produced:

| Exponent | Node 24.16.0 before → after | Node 26.5.0 before → after |
|---|---|---|
| +1,000 | 0.013 → 0.003 ms | 0.014 → 0.003 ms |
| -1,000 | 0.014 → 0.017 ms | 0.018 → 0.015 ms |
| +100,000 | 5.753 → 0.002 ms | 5.678 → 0.002 ms |
| -100,000 | 5.927 → 5.947 ms | 5.833 → 5.746 ms |
| +1,000,000 | 94.945 → 0.003 ms | 92.589 → 0.002 ms |
| -1,000,000 | 96.084 → 95.410 ms | 94.286 → 94.338 ms |

These measurements cover normalization, not subsequent serialization or
arithmetic. JavaScript can defer flattening repeated/concatenated strings;
consuming the full result still requires work proportional to its size.
Fractional reduction shows no consistent improvement. This shortcut does not
establish a general input-size or intermediate-work limit.

## Reinforcing-order comparison trial

Run `node scripts/exact-reinforcing-order-bench.mjs` alone to compare the
reinforcing-order shortcut with a reference that normalizes both inputs and
compares cross-products directly. The existing
`node scripts/exact-cross-product-bench.mjs` trial uses opposing numerator and
denominator orders and continues to exercise the general cross-product path.

An [unequal-denominator checkpoint](../../benchmarks/unequal-comparison-current-review.json)
reruns that general path on Node 24.21.0 and 26.8.1. All 108 comparisons per
major match the analytically expected sign at 1,000, 10,000 and 100,000 scale
digits, for both positive and negative fractions. At the largest size, current
medians are 38.362/38.063 ms on Node 24 and 37.755/37.802 ms on Node 26
(positive/negative); reference medians range from 37.611 to 38.250 ms.
The record retains all samples and source hashes. Runs are sequential, with
reference before current in each case, two warmups and seven measured calls;
normalization is timed, fixture construction and assertions are not. This
standalone comparison fixture exceeds default model numeric budgets. It shows
comparable measured costs, not a speedup, memory bound or universal arithmetic
limit; no further optimization follows from this case alone.

The reinforcing-order trial covers positive and negative fractions at 1,000,
10,000 and 100,000 digits, with two warmups and seven measured samples per case.
Fixture construction and result assertions are outside timing; normalization is
included. At the 100,000-digit scale, local medians were:

| Runtime | Fraction signs | Cross-product reference | Order shortcut |
|---|---|---:|---:|
| Node 24.21.0 | Positive | 37.523 ms | 26.507 ms |
| Node 24.21.0 | Negative | 37.826 ms | 26.516 ms |
| Node 26.8.1 | Positive | 37.203 ms | 26.271 ms |
| Node 26.8.1 | Negative | 39.611 ms | 26.324 ms |

This measures the stated arithmetic reference against the shortcut, rather than
comparing releases or complete solver workloads. Normalization still dominates.
The current shortcut includes canonical text ordering described below. These
measurements do not establish a general speedup or a resource budget.

The cross-product control script now also runs the direct reference, using two
warmups and seven measured samples per case with assertions outside timing.
At 100,000 digits, the current comparison stays close to that reference:

| Runtime | Sign | Cross-product reference | Current comparison |
|---|---|---:|---:|
| Node 24.21.0 | Positive | 37.552 ms | 37.522 ms |
| Node 24.21.0 | Negative | 37.909 ms | 37.707 ms |
| Node 26.8.1 | Positive | 37.174 ms | 37.111 ms |
| Node 26.8.1 | Negative | 37.302 ms | 37.226 ms |

Both scripts retain every measured sample. The
[fraction control record](../../benchmarks/exact-fraction-order-control-review.json)
contains the sequential macOS arm64 runs for both workloads and runtimes. These
controls show no material overhead for this cross-product fixture; their small
timing differences are not evidence of a general improvement in cross-products.

## Canonical integer order trial

Exact comparison normalizes and validates both operands first, then compares
canonical integer text by sign, digit count and lexical order. Equal-denominator,
zero, opposite-sign, equal-numerator and reinforcing-order shortcuts therefore
avoid reparsing normalized magnitudes into BigInts. Comparisons that need
cross-products still allocate BigInts. Fraction normalization may itself require
BigInt parsing and GCD work; this does not remove that cost.

Run `node scripts/exact-integer-order-bench.mjs` alone. It compares integer-valued
decimal inputs with a reference that normalizes both operands and reparses their
numerators as BigInts. Positive and negative cases use 1,000, 100,000 and
1,000,000 digits, two warmups and seven measured samples. Normalization is timed;
fixture construction and assertions are excluded. Local one-million-digit medians:

| Runtime | Sign | BigInt reference | Text order |
|---|---|---:|---:|
| Node 24.21.0 | Positive | 127.116 ms | 1.153 ms |
| Node 24.21.0 | Negative | 127.804 ms | 1.380 ms |
| Node 26.8.1 | Positive | 127.378 ms | 1.108 ms |
| Node 26.8.1 | Negative | 128.286 ms | 1.097 ms |

[Raw samples](../../benchmarks/exact-integer-order-review.json) record the macOS
arm64 trial. These are standalone Exact workloads, not model-size limits or
complete solver timings. Existing operand validation remains in force, and
there is still no general standalone input-size or intermediate-work budget.

## Zero detection trial

`Exact.isZero` validates numerator and denominator integer fields but does not
reduce a fraction merely to inspect its numerator. A zero denominator is still
invalid even when the numerator is zero. Each field is read once, and an invalid
numerator fails before reading the denominator. Decimal strings share the
normalizer's syntax and safe-integer exponent checks, then inspect the coefficient
without expanding its magnitude. For example, `Exact.isZero('1e9007199254740991')`
returns false without allocating that number; this does not mean normalizing or
solving with that magnitude is practical or within model limits.

Linearity analysis uses this predicate after evaluating a constant divisor.
The shortcut avoids another normalization of that result; initial evaluation and
other arithmetic retain their existing costs and limits.

Run `node scripts/exact-zero-bench.mjs` alone to compare the predicate with full
rational normalization. The trial uses zero/nonzero numerators and denominators
of 1,000, 100,000 and 1,000,000 digits, two warmups and seven measured samples.
Validation is timed; fixture construction and assertions are excluded. Local
one-million-digit medians:

| Runtime | Numerator | Normalization reference | Zero detection |
|---|---|---:|---:|
| Node 24.21.0 | Nonzero | 208.396 ms | 0.779 ms |
| Node 24.21.0 | Zero | 0.390 ms | 0.389 ms |
| Node 26.8.1 | Nonzero | 206.269 ms | 0.778 ms |
| Node 26.8.1 | Zero | 0.390 ms | 0.385 ms |

[Raw samples](../../benchmarks/exact-zero-review.json) record the sequential macOS
arm64 trials. Zero numerators already avoided expensive normalization, so the
small timing differences in those controls are not evidence of a speedup.
This predicate improvement does not add a general arithmetic resource budget.
