# @cave/fusion

The CAVE probabilistic layer (spec §10) — pure functions over `@cave/core`
claims. The math is an implementation layer, not required syntax: CAVE
itself only stores claims and metadata.

```ts
import { fuseClaims, noisyAndIndependent } from '@cave/fusion'

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

`estimateOf(claim)` extracts `{ mean, sigma, conf }` from any numeric claim
carrying `+/-` uncertainty (attribute or metric payload); claims without a
usable estimate are skipped, zero-confidence and zero-σ estimates
contribute nothing. The spec's worked example is a test case verbatim.

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

## Tests

```
pnpm --filter @cave/fusion test
```
