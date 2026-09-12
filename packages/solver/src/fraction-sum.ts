const probeThreshold = 1n << 1024n

/** Avoid repeated large denominator factors when a short Euclidean probe finds them. */
export const sum = (a: bigint, b: bigint, c: bigint, d: bigint): readonly [bigint, bigint] => {
  if (b === d) return [a + c, b]
  let x = b < 0n ? -b : b
  let y = d < 0n ? -d : d
  if (x >= probeThreshold && y >= probeThreshold) {
    if (x < y) [x, y] = [y, x]
    // A full GCD can cost more than the products it avoids for coprime inputs.
    // An unfinished probe leaves the ordinary exact addition unchanged.
    for (let step = 0; step < 6 && y !== 0n; step++) [x, y] = [y, x % y]
    if (y === 0n && x > 1n) {
      const leftScale = d / x
      const rightScale = b / x
      return [a * leftScale + c * rightScale, b * leftScale]
    }
  }
  return [a * d + c * b, b * d]
}
