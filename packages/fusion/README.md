# @cavelang/fusion

The CAVE probabilistic layer (spec §10) — pure functions over `@cavelang/core`
claims. The math is an implementation layer, not required syntax: CAVE
itself only stores claims and metadata.

```ts
import { fuseClaims, noisyAndIndependent } from '@cavelang/fusion'

// revenue IS 18B USD/yr +/- 3B USD/yr @ 60%   (analyst)
// revenue IS 20B USD/yr +/- 0.5B USD/yr @ 95% (filing)
fuseClaims([analyst, filing])
// → { mean: ≈19.97e9, sigma: ≈0.25e9 } — the filing dominates

noisyAndIndependent(0.8, [0.6]) // → 0.48
```

## Bayesian fusion (§10.1)

For normally distributed estimates with `+/- Δ` at kσ: σ = Δ/k, precision
= 1/σ², confidence acts as a weight multiplier:

- weighted precision wᵢ = pᵢ / σᵢ²
- posterior mean μ = Σ wᵢxᵢ / Σ wᵢ
- posterior σ = 1 / √(Σ wᵢ)

`estimateOf(claim)` extracts `{ mean, sigma, conf }` plus the optional `unit`
from a numeric claim carrying `+/-` uncertainty (attribute or metric payload).
It returns `undefined` without a numeric payload or uncertainty. `fuseClaims`
omits those claims, and fusion skips zero-confidence estimates after validation.
Extraction validates the returned estimate's finite mean and confidence in
`[0, 1]`, including structurally constructed claims that bypass `Claim.of`.
Invalid values throw `RangeError` even at zero confidence; a valid
zero-confidence claim still extracts an estimate, which `fuse` subsequently skips.
These helpers operate on the supplied occurrences: they do not resolve store
history, deduplicate claims or group source contexts. Supplying an old estimate
beside its zero-confidence retraction still includes the old estimate. Repeating
an estimate four times contributes four times its precision and halves its
posterior sigma. Select current evidence for the intended snapshot and quantity,
and account for repeated or correlated observations before calling `fuseClaims`.
Invalid zero,
negative, or non-finite σ values throw the same typed core uncertainty error
used by parsed and constructed claims. `estimateOf` also validates sigma after
converting the uncertainty unit to the value's unit: overflow or underflow
throws `Uncertainty.InvalidUncertaintyError` instead of returning an infinite
or zero spread. Finite, positive converted spreads remain valid, including
representable subnormal values. The spec's worked example is a test
case verbatim.

`estimateOf` captures the payload's numeric value and unit and the uncertainty's
magnitude and unit once. Sigma calculation and unit conversion use those captured
fields, so changing getters cannot mix separate uncertainty observations.

`fuse` captures each estimate's mean, sigma, confidence and unit once before
validation and calculation. `noisyAndIndependent` validates and multiplies each
condition value in one pass, still validating later conditions after a zero.
`normalizeHypotheses` captures each confidence and its enumerable metadata before
normalizing. Getter-backed inputs therefore cannot substitute an unvalidated
second value during calculation. Inherited confidence fields and enumerable
symbol metadata retain their normal meaning; normalization returns fresh objects.

All confidence inputs to fusion and the conditional/hypothesis helpers must be
finite probabilities in `[0, 1]`; invalid values throw `RangeError`. Estimate
means must also be finite. Every estimate is validated before zero-confidence
entries are skipped. Omitted or `undefined` estimate confidence defaults to 1;
explicit `null` is invalid. A supplied estimate unit must be a string, otherwise
validation throws `TypeError`, even on a zero-confidence estimate. Arbitrary
string units retain the exact-match rules below.
Fusion normalizes weights and means to avoid intermediate
overflow and uses compensated summation for both total weight and posterior mean
contributions. This retains the combined precision of many weak estimates beside
a strong estimate and smaller mean contributions beside large opposing estimates.
Subnormal means are scaled by a power of two before weighting, and a finite
compensated weighted sum is divided only once. This avoids erasing representable
tiny averages through premature rounding, including equal means with unequal
weights and small residuals after cancellation. If the unnormalized weighted
sum overflows, or subnormal weighted products contribute to a subnormal provisional
mean, a fallback sums binary64 mean and normalized-weight products as
exact integers and rounds their quotient once, with halfway cases rounded to
even. This preserves subnormal residuals even when large estimates cancel and
individual weighted contributions would round to zero. It also corrects early
rounding of nonzero subnormal products after cancellation, even when the sum
never overflows. Other finite sums retain the compensated floating-point path. The fallback does not make unit
conversion, weight calculation or the entire fusion procedure exact.
Its integer operands come from finite binary64 means and normalized weights,
so their widths are bounded by binary64 exponents rather than arbitrary-length
numeric text. Summing more terms can increase the accumulator width; traversal,
temporary storage and exact arithmetic still cost more as the estimate count
grows. These pure synchronous helpers impose no estimate-count limit,
cancellation check or wall-clock deadline. Callers managing large evidence sets
must bound that work before calling them.
The returned mean is bounded to the smallest and largest converted means with
positive weight, preventing roundoff from extrapolating beyond the evidence.
In particular, identical converted means retain that exact mean regardless of
their relative weights.
After validating all estimates and calculating the posterior precision and spread,
fusion returns an identical converted mean directly. Mixed signed zeros keep the
general path. This avoids unnecessary weighted sums and exact fallback work,
while retaining invalid-input and unrepresentable-precision errors.
When an individual root precision becomes subnormal or underflows during its
initial division, normalization uses its separate confidence and spread factors
when their combined denominator is finite. A representable
mean contribution can therefore survive even when that unnormalized root
precision cannot be represented on its own.
Converted estimates and the posterior's positive precision and spread
must fit finite JavaScript numbers, otherwise it throws `RangeError` rather than
returning `NaN`, infinity, or zero precision. This is a numeric representation
limit, not evidence that an estimate has zero confidence.

Claim, estimate, condition and hypothesis arrays must be dense. A missing array slot
is invalid evidence and throws, including when a preceding probability is zero.
Empty arrays retain their usual meanings: no conditions leave claim confidence
unchanged, fusion and normalization return `undefined`, and an empty hypothesis
set has gap `-1`.

Fusion preserves units at the library boundary. Missing units combine only
with missing units, arbitrary units combine only by exact equality, and the
fixed-duration units `ms`, `s`, `min`, and `h` convert to the first positive-confidence estimate's
unit before weighting. Every other mixture throws a typed `FusionUnitError`;
adapters surface that same failure instead of maintaining separate checks.
Reordering usable estimates can therefore change the output unit while retaining
the same physical mean, spread and precision after conversion. A zero-confidence
estimate does not select the output unit.

## Conditional confidence (§10.2)

`noisyAndIndependent(pClaim, pConditions)` multiplies through — named
loudly because the spec requires the independence assumption to be
explicit in the query engine, never silently assumed.

## Competing hypotheses (§10.3)

`normalizeHypotheses` rescales an exhaustive hypothesis set to sum to 1
(preserving proportions, as in the spec's post-evidence redistribution);
`hypothesisGap` measures how far a set is from exhaustive. Redistribution
itself stays manual — new confidences are appended as new claims, which is
the append-only §9 discipline, not a computation.

Both helpers use compensated summation so many small probabilities alongside a
dominant hypothesis contribute to the total instead of disappearing one by one
through rounding. `hypothesisGap` subtracts the unit baseline before combining
the summation correction, preserving representable excesses and deficits that
would disappear if the total were first rounded near one. For example,
`hypothesisGap([1, 2 ** -54])` returns `2 ** -54` rather than zero. Results still
use JavaScript floating-point precision.
Normalization returns new records with updated confidences, preserving the
other enumerable fields and leaving the input records untouched. Empty and
all-zero sets return `undefined`; equal positive probabilities normalize equally,
including the smallest positive representable values.

## Fallback cost trial

Run `node scripts/fusion-fallback-bench.mjs` from the repository root. The trial
uses 128, 1,024 and 8,192 estimates, two untimed warmups and nine single-call
samples per fixture. Input construction and correctness assertions are outside
the timer. All samples, runtime details and source hashes are retained in
[the fusion fallback trial](../../benchmarks/fusion-fallback-review.json).
Sequential macOS arm64 runs gave these median milliseconds for 8,192 estimates:

| Fixture | Node 24 before | Node 24 after | Node 26 before | Node 26 after |
|---|---:|---:|---:|---:|
| Identical mean 42 | 0.923 | 0.969 | 0.847 | 0.858 |
| Identical MAX_VALUE | 13.770 | 1.184 | 14.013 | 0.895 |
| Overflow cancellation with tiny residual | 4.635 | 5.144 | 4.473 | 4.715 |
| Finite cancellation with tiny residual | 4.377 | 4.551 | 3.802 | 5.204 |

“Before” already includes the exact overflow and subnormal-product fallbacks;
“after” adds the identical-mean shortcut. Both preserve each fixture's expected
mean, precision and spread. The extreme identical-mean case benefits because it
previously entered the exact fallback. Ordinary identical means show no material
improvement at this size, and the unchanged cancellation paths vary between
runs. These fixed-order samples are bounded measurements, not a workload cap,
statistical confidence interval or browser performance result. The integer
fallback still costs more than ordinary fusion and scales with input count.

## Tests

The fusion cancellation tests compare 768 deterministic ordered cases with an
independent integer-weight oracle. Powers-of-two uncertainty and confidence
make scaled weights exact small integers; opposite large means cancel
analytically, leaving a rational number of `MIN_VALUE` units. The oracle rounds
that rational directly, without using the fallback's binary64 decomposition.
Cases vary signed tiny means, input order, uncertainty, confidence, cancelling
pair count, and large magnitudes of 1 or MAX_VALUE. They check mean and precision.
This validates a bounded cancellation family, not arbitrary floating-point
inputs, unit-conversion rounding or a general exact-fusion guarantee.

The hypothesis-gap tests compare 768 ordered near-unit calculations against
BigInt sums of exactly representable binary fractions. The fixtures include
positive, negative and zero gaps and three input orders; they independently
check the cancellation boundary without using the floating-point summation
implementation as the expected result. This is bounded numerical coverage,
not a claim of correctly rounded results for every possible probability set.

```
pnpm --filter @cavelang/fusion test
```
