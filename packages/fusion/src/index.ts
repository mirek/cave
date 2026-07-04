/**
 * `@cavelang/fusion` — the CAVE probabilistic layer (spec §10).
 *
 * Pure functions over `@cavelang/core` claims: Bayesian fusion of numeric
 * estimates (§10.1), noisy-AND conditional confidence under an explicit
 * independence assumption (§10.2), and competing-hypothesis helpers
 * (§10.3). No storage, no I/O.
 */

export { fuse, fuseClaims, estimateOf } from './fuse.ts'
export type { Estimate, Posterior } from './fuse.ts'
export { noisyAndIndependent, normalizeHypotheses, hypothesisGap } from './conditional.ts'
