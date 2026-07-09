/**
 * Query expectations — behavioral checks over the extracted store
 * (roadmap item 9).
 *
 * A queries file holds CAVE-Q patterns, each followed by indented
 * expectation lines written exactly as `cave query` prints solutions:
 *
 * ```cave
 * ; ancestors nobody wrote down — the extraction must support the hops
 * ?a PARENT-OF+ me
 *   ?a = anna
 *   ?a = maria
 * jan HAS birth-year: ?y
 *   WHERE conf >= 0.6
 *   ?y = 1932
 * jan HAS birthplace: Kraków      ; no expectations = the pattern must hold
 * me PARENT-OF ?child
 *   none                          ; the pattern must have no matches
 * ```
 *
 * - `WHERE …` lines extend the pattern (spec §12.2).
 * - `?var = value` lines are the expected solutions — compared as a set
 *   of distinct binding records, order-insensitive, and *exact*: missing
 *   solutions fail, unexpected ones fail too (an invented ancestor is as
 *   wrong as a lost one).
 * - `none` expects zero matches; no expectation lines expect at least one.
 *
 * Blank lines and full-line `;` comments are skipped. Because claim-key
 * scoring is exact about naming, these checks are where an eval asserts
 * *usefulness* — that multi-hop questions the source only implies come
 * back right — independent of how the golden spelled each claim.
 */

import { query } from '@cavelang/query'
import type { Store } from '@cavelang/store'

export type Expect =
  | { readonly kind: 'some' }
  | { readonly kind: 'none' }
  | { readonly kind: 'solutions', readonly solutions: readonly Readonly<Record<string, string>>[] }

export type Query = {
  /** Pattern text, `WHERE` filter lines included. */
  readonly pattern: string
  readonly expect: Expect
  /** 1-based line of the pattern in the queries file. */
  readonly line: number
}

export type Parsed = {
  readonly queries: readonly Query[]
  readonly problems: readonly string[]
}

const bindingRe = /\?([^\s=]+)\s*=\s*/g

/** @returns the solution record of one `?var = value` line, or `undefined`. */
const parseSolution = (text: string): undefined | Record<string, string> => {
  const found = [...text.matchAll(bindingRe)]
  if (found.length === 0 || found[0]!.index !== 0) {
    return undefined
  }
  const solution: Record<string, string> = {}
  for (const [at, match] of found.entries()) {
    const next = found[at + 1]
    const value = text.slice(match.index + match[0].length, next?.index).trim()
    if (value === '') {
      return undefined
    }
    solution[match[1]!] = value
  }
  return solution
}

/** Parses a queries file. */
export const parseQueries = (text: string): Parsed => {
  const queries: Query[] = []
  const problems: string[] = []
  let current: undefined | { pattern: string[], line: number, none: boolean, solutions: Record<string, string>[] }

  const flush = (): void => {
    if (current === undefined) {
      return
    }
    const expect: Expect =
      current.none ? { kind: 'none' } :
      current.solutions.length > 0 ? { kind: 'solutions', solutions: current.solutions } :
      { kind: 'some' }
    queries.push({ pattern: current.pattern.join('\n'), expect, line: current.line })
    current = undefined
  }

  text.split('\n').forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith(';')) {
      return
    }
    if (trimmed.startsWith('WHERE ')) {
      if (current === undefined) {
        problems.push(`queries line ${line}: WHERE without a pattern`)
        return
      }
      current.pattern.push(trimmed)
      return
    }
    if (!/^\s/.test(raw)) {
      flush()
      current = { pattern: [trimmed], line, none: false, solutions: [] }
      return
    }
    if (current === undefined) {
      problems.push(`queries line ${line}: expectation without a pattern`)
      return
    }
    if (trimmed === 'none') {
      if (current.none || current.solutions.length > 0) {
        problems.push(`queries line ${line}: 'none' conflicts with other expectations`)
        return
      }
      current.none = true
      return
    }
    const solution = parseSolution(trimmed)
    if (solution === undefined) {
      problems.push(`queries line ${line}: expected '?var = value' bindings or 'none', got ${JSON.stringify(trimmed)}`)
      return
    }
    if (current.none) {
      problems.push(`queries line ${line}: 'none' conflicts with other expectations`)
      return
    }
    current.solutions.push(solution)
  })
  flush()
  return { queries, problems }
}

export type Outcome = {
  readonly pattern: string
  readonly pass: boolean
  /** Distinct solutions the store answered. */
  readonly matches: number
  /** Expected solutions the store did not answer. */
  readonly missing: readonly Readonly<Record<string, string>>[]
  /** Answered solutions the expectations exclude (`solutions` and `none` kinds). */
  readonly unexpected: readonly Readonly<Record<string, string>>[]
  /** Pattern compilation error, when the query could not run. */
  readonly error?: string
}

const recordKey = (record: Readonly<Record<string, string>>): string =>
  JSON.stringify(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))

/** Runs one query against the store and checks its expectation. */
export const checkQuery = (
  store: Store,
  q: Query,
  options: { aliases?: boolean } = {}
): Outcome => {
  let records: Readonly<Record<string, string>>[]
  try {
    const seen = new Map<string, Readonly<Record<string, string>>>()
    for (const match of query(store, q.pattern, { aliases: options.aliases === true })) {
      seen.set(recordKey(match.bindings), match.bindings)
    }
    records = [...seen.values()]
  } catch (error) {
    return {
      pattern: q.pattern,
      pass: false,
      matches: 0,
      missing: [],
      unexpected: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
  switch (q.expect.kind) {
    case 'some':
      return { pattern: q.pattern, pass: records.length > 0, matches: records.length, missing: [], unexpected: [] }
    case 'none':
      return { pattern: q.pattern, pass: records.length === 0, matches: records.length, missing: [], unexpected: records }
    case 'solutions': {
      const expected = new Map(q.expect.solutions.map(solution => [recordKey(solution), solution]))
      const actual = new Map(records.map(record => [recordKey(record), record]))
      const missing = [...expected].filter(([key]) => !actual.has(key)).map(([, solution]) => solution)
      const unexpected = [...actual].filter(([key]) => !expected.has(key)).map(([, record]) => record)
      return {
        pattern: q.pattern,
        pass: missing.length === 0 && unexpected.length === 0,
        matches: records.length,
        missing,
        unexpected
      }
    }
  }
}

/** @returns one solution rendered the way `cave query` prints it. */
export const formatSolution = (record: Readonly<Record<string, string>>): string => {
  const entries = Object.entries(record)
  return entries.length === 0 ? '(match)' : entries.map(([name, value]) => `?${name} = ${value}`).join('  ')
}
