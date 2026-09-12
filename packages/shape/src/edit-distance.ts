/** Exact UTF-16 Levenshtein distance when within the non-negative integer limit. */
export const distanceWithin = (a: string, b: string, limit: number): number | undefined => {
  if (Math.abs(a.length - b.length) > limit) return undefined
  if (a.length < b.length) [a, b] = [b, a]
  let previous = Array<number>(b.length + 1).fill(Infinity)
  let current = Array<number>(b.length + 1).fill(Infinity)
  for (let j = 0; j <= Math.min(b.length, limit); j += 1) previous[j] = j
  for (let i = 1; i <= a.length; i += 1) {
    // A path at most `limit` edits long cannot leave this diagonal band.
    const low = Math.max(1, i - limit)
    const high = Math.min(b.length, i + limit)
    current[low - 1] = low === 1 ? i : Infinity
    if (high < b.length) current[high + 1] = Infinity
    let minimum = current[low - 1]!
    for (let j = low; j <= high; j += 1) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      minimum = Math.min(minimum, current[j]!)
    }
    // Every path to the final cell crosses this row; none can recover now.
    if (minimum > limit) return undefined
    const swap = previous
    previous = current
    current = swap
  }
  const distance = previous[b.length]!
  return distance <= limit ? distance : undefined
}
