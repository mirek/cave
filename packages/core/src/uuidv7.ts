/**
 * UUIDv7 transaction identifiers (spec §9.1).
 *
 * CAVE storage is append-only; each appended claim carries a transaction id.
 * UUIDv7 is recommended because it encodes timestamp and ordering — ids sort
 * lexicographically by creation time, so `MAX(tx)` resolves current belief.
 *
 * {@link next} is strictly monotonic within a process: same-millisecond calls
 * increment a 12-bit sequence in the `rand_a` field, and a backwards system
 * clock never produces a smaller id.
 */

const hex = (n: number, digits: number): string =>
  n.toString(16).padStart(digits, '0')

/**
 * Formats a UUIDv7 from parts — pure, for tests and deterministic imports.
 *
 * @param ms unix timestamp in milliseconds (48 bits)
 * @param seq 12-bit sequence placed in `rand_a`
 * @param rand 62 bits of randomness for `rand_b` as 8 bytes (top 2 bits are
 * overwritten by the variant)
 */
export const at = (ms: number, seq: number, rand: Uint8Array): string => {
  if (!Number.isInteger(ms) || ms < 0 || ms > 0xffff_ffff_ffff) {
    throw new Error(`Expected 48-bit millisecond timestamp, got ${ms}.`)
  }
  if (!Number.isInteger(seq) || seq < 0 || seq > 0xfff) {
    throw new Error(`Expected 12-bit sequence, got ${seq}.`)
  }
  if (rand.length < 8) {
    throw new Error(`Expected 8 random bytes, got ${rand.length}.`)
  }
  const time = hex(ms, 12)
  const variantByte = (rand[0]! & 0x3f) | 0x80
  return [
    time.slice(0, 8),
    time.slice(8, 12),
    `7${hex(seq, 3)}`,
    hex(variantByte, 2) + hex(rand[1]!, 2),
    [...rand.slice(2, 8)].map(byte => hex(byte, 2)).join('')
  ].join('-')
}

let lastMs = -1
let lastSeq = 0

/**
 * @returns next monotonic UUIDv7. Strictly increasing (lexicographically)
 * within the process even across same-millisecond calls and clock skew.
 */
export const next = (now: () => number = Date.now): string => {
  let ms = now()
  if (ms <= lastMs) {
    ms = lastMs
    lastSeq += 1
    if (lastSeq > 0xfff) {
      ms += 1
      lastSeq = 0
    }
  } else {
    lastSeq = 0
  }
  lastMs = ms
  const rand = new Uint8Array(8)
  // Web Crypto is available in supported Node.js releases and browsers,
  // keeping UUID generation portable without weakening randomness.
  globalThis.crypto.getRandomValues(rand)
  return at(ms, lastSeq, rand)
}

/**
 * @returns the unix millisecond timestamp encoded in a UUIDv7's first
 * 48 bits — how transaction ids answer *when* (spec §9.1, §20.2 staleness).
 */
export const msOf = (id: string): number =>
  Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16)

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** @returns `true` if `s` is a well-formed UUIDv7 string. */
export const is = (s: string): boolean =>
  uuidRe.test(s)

/** @returns the 12-bit monotonic sequence in a UUIDv7's `rand_a` field. */
const seqOf = (id: string): number =>
  Number.parseInt(id.slice(15, 18), 16)

/**
 * The Lamport receive rule (spec §28.2): after observing an id — a merged
 * row's tx, or a store's `MAX(tx)` at open — {@link next} never mints at or
 * below it. This generalizes §9.1's single-writer monotonicity to the
 * *store*: appends after a merge sort after everything merged, whatever the
 * origin machine's clock read. Non-v7 ids are ignored.
 */
export const observe = (id: string): void => {
  if (!is(id)) {
    return
  }
  const ms = msOf(id)
  const seq = seqOf(id)
  if (ms > lastMs || (ms === lastMs && seq > lastSeq)) {
    lastMs = ms
    lastSeq = seq
  }
}

/**
 * Runs synchronous speculative work without retaining UUID generator state.
 * Database dry-runs use this alongside transaction rollback so explicit-id
 * observations and locally minted rows are both absent after the preview.
 */
export const withStatePreserved = <T>(body: () => T): T => {
  const savedMs = lastMs
  const savedSeq = lastSeq
  try {
    return body()
  } finally {
    lastMs = savedMs
    lastSeq = savedSeq
  }
}
