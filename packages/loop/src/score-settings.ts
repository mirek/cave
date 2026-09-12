/** Scoring factors and floors must support meaningful numeric comparisons. */
export const validateScoreSetting = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite nonnegative number`)
  }
}

/** Reject overflow before a built-in policy offers a nonfinite frontier score. */
export const propagatedScore = (parent: number, confidence: number, decay: number): number => {
  const score = parent * confidence * decay
  if (!Number.isFinite(score)) throw new RangeError('reconstruction score must be finite')
  return score
}
