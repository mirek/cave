import { gcd } from './integer-gcd.ts'
/** Cancel across factors before allocating a rational product's intermediates. */
export const product = (a: bigint, b: bigint, c: bigint, d: bigint): readonly [bigint, bigint] => {
  // Leave zero-denominator diagnostics to the caller's existing normalizer.
  if (b === 0n || d === 0n) return [0n, 0n]
  if (a === 0n || c === 0n) return [0n, 1n]
  const left = gcd(a, d)
  const right = gcd(c, b)
  return [(a / left) * (c / right), (b / right) * (d / left)]
}
