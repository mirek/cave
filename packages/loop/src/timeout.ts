/** Convert adapter seconds without rejecting whole-millisecond decimal input. */
export const completionTimeoutMs = (seconds: number): number => {
  const milliseconds = typeof seconds === 'number' ? seconds * 1000 : NaN
  const rounded = Math.round(milliseconds)
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(milliseconds))
  if (!Number.isFinite(milliseconds) || seconds < 0 ||
      rounded < (seconds === 0 ? 0 : 1) || rounded > 2147483647 ||
      Math.abs(milliseconds - rounded) > tolerance) {
    throw new TypeError('timeoutSeconds must resolve to whole milliseconds in 0..2147483647; zero disables the deadline')
  }
  return rounded
}
