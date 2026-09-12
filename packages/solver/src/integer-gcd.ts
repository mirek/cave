const batchThreshold = 1n << 1024n

/** Exact nonnegative GCD, with Lehmer batches for large operands. */
export const gcd = (left: bigint, right: bigint): bigint => {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  if (a < b) [a, b] = [b, a]
  while (b !== 0n) {
    if (a === b) return a
    if (b < batchThreshold) {
      while (b !== 0n) {
        const remainder = a % b
        a = b
        b = remainder
      }
      return a
    }
    {
      // Hex length gives a cheap common shift retaining at most 64 leading bits.
      const shift = BigInt(Math.max(0, a.toString(16).length * 4 - 64))
      let x = a >> shift
      let y = b >> shift
      let A = 1n, B = 0n, C = 0n, D = 1n
      for (let step = 0; step < 64 && x >= y && y > 0n && y + C > 0n && y + D > 0n; step++) {
        const q = (x + A) / (y + C)
        if (q <= 0n || q !== (x + B) / (y + D)) break
        ;[A, B, C, D] = [C, D, A - q * C, B - q * D]
        ;[x, y] = [y, x - q * y]
      }
      if (B !== 0n) {
        const nextA = A * a + B * b
        const nextB = C * a + D * b
        // Each matrix step has determinant -1, preserving the GCD exactly.
        // Check full-width progress before accepting the approximate batch.
        if (nextA >= nextB && nextB >= 0n && nextA < a && nextB < b) {
          a = nextA
          b = nextB
          continue
        }
      }
    }
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}
