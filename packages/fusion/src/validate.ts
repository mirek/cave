/** Shared numeric boundary for probabilities accepted by the fusion API. */
export const validateConfidence = (conf: number): void => {
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
    throw new RangeError('confidence must be finite and between 0 and 1')
  }
}
