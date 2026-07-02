/**
 * Conditional confidence — noisy-AND (spec §10.2), and competing-hypothesis
 * helpers (spec §10.3).
 *
 * Treating a claim's conditions as independent:
 *
 *   p_effective = p_claim × Π p_conditionᵢ
 *
 * The independence assumption MUST be explicit in the query engine — never
 * silently assumed for all domains (spec §10.2); hence the deliberately
 * loud function name.
 */

/**
 * Noisy-AND under an explicit independence assumption:
 * `noisyAndIndependent(0.8, [0.6])` → 0.48 (spec §10.2's example).
 */
export const noisyAndIndependent = (claimConf: number, conditionConfs: readonly number[]): number =>
  conditionConfs.reduce((product, conf) => product * conf, claimConf)

/**
 * Normalizes an exhaustive hypothesis set so confidences sum to 1
 * (spec §10.3: "confidences of an exhaustive hypothesis set should sum to
 * ~100%"). Proportions are preserved.
 * @returns `undefined` when every confidence is 0.
 */
export const normalizeHypotheses = <T extends { readonly conf: number }>(
  hypotheses: readonly T[]
): undefined | (T & { readonly conf: number })[] => {
  const total = hypotheses.reduce((sum, hypothesis) => sum + hypothesis.conf, 0)
  if (!(total > 0)) {
    return undefined
  }
  return hypotheses.map(hypothesis => ({ ...hypothesis, conf: hypothesis.conf / total }))
}

/**
 * @returns how far a hypothesis set is from exhaustive (Σ conf − 1);
 * ≈0 for a well-formed set, negative when probability mass is missing.
 */
export const hypothesisGap = (confs: readonly number[]): number =>
  confs.reduce((sum, conf) => sum + conf, 0) - 1
