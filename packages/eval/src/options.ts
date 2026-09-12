/** Shared validation for direct scoring and evaluation orchestration. */
const describeOption = (value: unknown): string => {
  try { return String(value) }
  catch { return '[unprintable value]' }
}

export const validateTolerance = (tolerance = 0): void => {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) {
    throw new Error(`tolerance must be a finite number in [0, 1], got ${describeOption(tolerance)}`)
  }
}

/** Positive integral repeat count, checked before suite discovery. */
export const validateRuns = (runs: number): void => {
  if (!Number.isSafeInteger(runs) || runs < 1) {
    throw new Error(`runs must be a positive safe integer, got ${describeOption(runs)}`)
  }
}

/** Positive whole-millisecond deadlines within Node's supported timer range. */
export const validateTimeoutSeconds = (seconds: number): void => {
  const milliseconds = typeof seconds === 'number' ? seconds * 1000 : NaN
  const rounded = Math.round(milliseconds)
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(milliseconds))
  if (!Number.isFinite(seconds) || seconds <= 0 || rounded < 1 || rounded > 2147483647 ||
      Math.abs(milliseconds - rounded) > tolerance) {
    throw new TypeError('timeoutSeconds must resolve to whole milliseconds in 1..2147483647 (0.001..2147483.647 seconds)')
  }
}
