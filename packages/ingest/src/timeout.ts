/** Convert seconds to the whole-millisecond range supported by Node timers. */
export const agentTimeoutMs = (seconds: number, allowZero = false): number => {
  const milliseconds = typeof seconds === 'number' ? seconds * 1000 : NaN
  const rounded = Math.round(milliseconds)
  // Decimal seconds such as 1.001 can acquire a sub-ULP multiplication error.
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(milliseconds))
  if (!Number.isFinite(milliseconds) || seconds < 0 || (!allowZero && seconds === 0) ||
      rounded < (allowZero && seconds === 0 ? 0 : 1) || rounded > 2147483647 ||
      Math.abs(milliseconds - rounded) > tolerance) {
    throw new TypeError('timeout must resolve to whole milliseconds in 1..2147483647 (0.001..2147483.647 seconds)')
  }
  return rounded
}
