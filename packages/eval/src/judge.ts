/**
 * The optional LLM judge — semantic-equivalence pairing
 * of what claim-key scoring could not match.
 *
 * Exact keys are deliberately strict: `grandma-maria` and `maria` are
 * different entities to the scorer even when a human sees one person.
 * The judge closes that gap without loosening the metric — after strict
 * matching, the unmatched golden claims and unmatched produced claims go
 * to a judge agent that pairs the ones stating the same fact. Judged
 * pairs never overwrite the strict scores; they produce a second,
 * *judged* precision/recall/F1 reported alongside.
 *
 * The protocol is the same as extraction agents (`@cavelang/ingest`): a
 * shell template (prompt on stdin and `{prompt-file}`) or an injected
 * function. The judge replies with one JSON array of `[G, P]` 1-based
 * index pairs — anything around it (prose, a code fence) is tolerated,
 * only the last well-formed array counts, out-of-range or duplicate
 * indices are dropped.
 */

import { lineOf } from './score.ts'
import type { Fact } from './score.ts'

/** @returns the judge prompt for unmatched golden/produced claims. */
export const judgePrompt = (misses: readonly Fact[], extras: readonly Fact[]): string => [
  'You are judging a knowledge-extraction eval written in CAVE — one atomic claim per line:',
  'subject VERB object, or subject HAS attribute: value, with optional @context, #tag and @ N% confidence.',
  '',
  'The golden claims below were expected but not produced verbatim; the produced claims were',
  'extracted but match no golden claim. Pair every golden claim with a produced claim ONLY when',
  'both state the same fact about the same real-world entity — tolerate naming, spelling and',
  'phrasing variation (grandma-maria vs maria), but never pair claims that disagree in meaning,',
  'direction or value. Judge conservatively: when unsure, do not pair. Each index may appear in',
  'at most one pair.',
  '',
  'Golden claims not produced:',
  ...misses.map((fact, index) => `G${index + 1}: ${lineOf(fact)}`),
  '',
  'Produced claims matching no golden claim:',
  ...extras.map((fact, index) => `P${index + 1}: ${lineOf(fact)}`),
  '',
  'Reply with ONLY a JSON array of [golden, produced] index pairs, e.g. [[1, 2], [3, 1]].',
  'Reply [] when nothing is equivalent.'
].join('\n')

/**
 * Parses the judge's reply into validated 0-based `[miss, extra]` pairs.
 * The *last* well-formed JSON array wins (agents often think aloud before
 * answering); malformed entries, out-of-range indices and reused indices
 * are dropped rather than failing the run.
 */
export const parsePairs = (output: string, misses: number, extras: number): [number, number][] => {
  // Balanced-bracket scan: each candidate runs from a `[` to its matching
  // `]`; a span that parses is consumed whole (inner arrays are not
  // re-considered), one that does not is re-entered at the next `[` — so
  // prose brackets before the answer cannot swallow it.
  let parsed: unknown
  let at = output.indexOf('[')
  while (at !== -1) {
    let depth = 0
    let end = -1
    for (let scan = at; scan < output.length; scan += 1) {
      if (output[scan] === '[') {
        depth += 1
      } else if (output[scan] === ']' && --depth === 0) {
        end = scan
        break
      }
    }
    if (end === -1) {
      break
    }
    try {
      parsed = JSON.parse(output.slice(at, end + 1))
      at = output.indexOf('[', end + 1)
    } catch {
      at = output.indexOf('[', at + 1)
    }
  }
  if (!Array.isArray(parsed)) {
    return []
  }
  const pairs: [number, number][] = []
  const usedMisses = new Set<number>()
  const usedExtras = new Set<number>()
  for (const entry of parsed) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      continue
    }
    const [golden, produced] = entry as unknown[]
    if (typeof golden !== 'number' || typeof produced !== 'number' ||
        !Number.isInteger(golden) || !Number.isInteger(produced) ||
        golden < 1 || golden > misses || produced < 1 || produced > extras ||
        usedMisses.has(golden) || usedExtras.has(produced)) {
      continue
    }
    usedMisses.add(golden)
    usedExtras.add(produced)
    pairs.push([golden - 1, produced - 1])
  }
  return pairs
}
