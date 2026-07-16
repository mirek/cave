/**
 * Alias discovery (spec §27) — propose same-entity candidates for review.
 *
 * §13.6 made merge and unmerge cheap; under LLM extraction the bottleneck
 * is *noticing* that `maria` and `grandma-maria` drifted apart. Everything
 * here is a read: candidates are scored by deterministic, explainable
 * string and graph signals, and the output is *suggested* `ALIAS` claims
 * at low confidence (0.3–0.5 — the §20.2 review band), tagged `#suggested`,
 * for a human to confirm or reject by ordinary appends. Discovery never
 * merges; a pair with any recorded `ALIAS` history is never re-suggested,
 * so review decisions stick. The optional LLM judge stays out-of-band
 * (§19.5): a prompt/reply contract, injected by the caller.
 */

import { Verb } from '@cavelang/core'
import type { Row, Store } from '@cavelang/store'

const currentSql = `
SELECT c.* FROM cave_claim c
JOIN (
  SELECT claim_key, MAX(tx) AS max_tx
  FROM cave_claim GROUP BY claim_key
) latest ON c.claim_key = latest.claim_key AND c.tx = latest.max_tx
`

/** One piece of evidence behind a suggestion (spec §27.2). */
export type Signal = {
  /** `equal`/`tokens`/`prefix`/`edit` are string signals, `value`/`neighbor` graph signals. */
  readonly kind: 'equal' | 'tokens' | 'prefix' | 'edit' | 'value' | 'neighbor'
  readonly score: number
  /** Human-readable evidence, also emitted as the suggested line's comment. */
  readonly detail: string
}

/** One proposed same-entity pair (spec §27), strongest first in results. */
export type Suggestion = {
  /** The less-established name — subject of the suggested claim. */
  readonly entity: string
  /** The more-established name — object of the suggested claim. */
  readonly canonical: string
  /** Combined evidence score in 0..1 (spec §27.2). */
  readonly score: number
  /** `score / 2`, clamped to 0.3..0.5 — the §20.2 review band. */
  readonly confidence: number
  readonly signals: readonly Signal[]
  /** The suggested claim as CAVE text: `entity ALIAS canonical #suggested @ N% ; evidence`. */
  readonly line: string
}

export type Options = {
  /** Minimum evidence score (spec §27.2), default {@link defaultMinScore}. */
  readonly minScore?: number
  /** At most this many suggestions, strongest first. */
  readonly limit?: number
}

export const defaultMinScore = 0.6

/** Actor stamped on written suggestions (spec §9.5, §27.3). */
export const suggestSource = 'suggest/alias'

/** Tag carried by every suggested claim, so review can find them (§13.5). */
export const suggestTag = 'suggested'

/**
 * System entities never suggested (spec §27.1): rules, actions, policy
 * sources and connect records are infrastructure, and their digest-shaped
 * names are string-similar by construction.
 */
const reservedPrefixes = ['rule/', 'action/', 'source/', 'connect/']

/** Entity test, as in §20's checks: not a verb token, not a stored literal. */
const isEntityName = (name: string): boolean =>
  !Verb.isVerbToken(name) && !name.startsWith('"') && !name.startsWith('`')

/** Lowercased with separators stripped — the comparison form. */
const norm = (name: string): string =>
  name.toLowerCase().replaceAll(/[-_./]+/g, '')

/** Lowercased `/-_.`-separated segments, deduplicated. */
const tokensOf = (name: string): Set<string> =>
  new Set(name.toLowerCase().split(/[-_./]+/).filter(token => token !== ''))

const stripDigits = (text: string): string =>
  text.replaceAll(/[0-9]+/g, '')

/**
 * Names differing only in digits (`api-v1` vs `api-v2`) are versions or
 * deliberate numbering more often than drift — prefix and edit similarity
 * ignore such pairs (spec §27.2).
 */
const digitOnlyDifference = (a: string, b: string): boolean =>
  a !== b && stripDigits(a) === stripDigits(b)

const editDistance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, at) => at)
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i]
    for (let j = 1; j <= b.length; j += 1) {
      next.push(Math.min(
        previous[j]! + 1,
        next[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      ))
    }
    previous = next
  }
  return previous[b.length]!
}

/**
 * Whether the segments the names do NOT share are themselves spelling
 * variants (edit similarity ≥ 0.75). Distinguishes drift (`grandma-mria` /
 * `grandma-maria`) from sibling naming (`north-tower` / `south-tower`) —
 * whole-string similarity alone cannot tell a typo from a differing word.
 */
const leftoverDrift = (a: string, b: string): boolean => {
  const [ta, tb] = [tokensOf(a), tokensOf(b)]
  const leftA = [...ta].filter(token => !tb.has(token))
  const leftB = [...tb].filter(token => !ta.has(token))
  if (leftA.length === 0 || leftB.length === 0) {
    return true
  }
  const [small, large] = leftA.length <= leftB.length ? [leftA, leftB] : [leftB, leftA]
  return small.every(token =>
    large.some(other => 1 - editDistance(token, other) / Math.max(token.length, other.length) >= 0.75))
}

/**
 * Order-free pair identity. Newline-joined: terms are single-line by
 * construction (§3), so the join cannot collide.
 */
const pairKey = (a: string, b: string): string =>
  a < b ? `${a}\n${b}` : `${b}\n${a}`

/** Everything one pass over current beliefs yields about the entity graph. */
type Graph = {
  /** Candidate entity names → current-row appearance count. */
  readonly counts: Map<string, number>
  /** Name → `out`/`in` relation-neighbor signature set (verb + other end). */
  readonly neighbors: Map<string, Set<string>>
  /** `attr\nvalue\nunit` → names carrying it (textual values ≥ 4 chars only). */
  readonly values: Map<string, Set<string>>
  /** Pairs connected by any current claim — related entities are distinct. */
  readonly related: Set<string>
  /** Pairs decided by any recorded `ALIAS` row, whatever its state. */
  readonly decided: Set<string>
  /** Name → alias-closure root over current positive `ALIAS` links. */
  readonly closureRoot: Map<string, string>
}

const readGraph = (store: Store): Graph => {
  const rows = store.db.prepare(`SELECT c.* FROM (${currentSql}) c WHERE c.conf > 0`).all() as unknown as Row.t[]
  // Entities carrying ingestion bookkeeping (`<path> HAS ingest-digest: …`)
  // are file records, not domain entities — similar paths are not aliases.
  const bookkeeping = new Set(rows.filter(row => row.attribute === 'ingest-digest').map(row => row.subject))
  const isCandidate = (name: string): boolean =>
    isEntityName(name) && !bookkeeping.has(name) && norm(name) !== '' &&
    !reservedPrefixes.some(prefix => name.startsWith(prefix))
  const counts = new Map<string, number>()
  const count = (name: string): void => {
    if (isCandidate(name)) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  const neighbors = new Map<string, Set<string>>()
  const neighbor = (name: string, signature: string): void => {
    neighbors.set(name, (neighbors.get(name) ?? new Set()).add(signature))
  }
  const values = new Map<string, Set<string>>()
  const related = new Set<string>()
  const aliasParent = new Map<string, string>()
  const find = (name: string): string => {
    const up = aliasParent.get(name)
    if (up === undefined || up === name) {
      return name
    }
    const root = find(up)
    aliasParent.set(name, root)
    return root
  }
  for (const row of rows) {
    count(row.subject)
    if (row.object !== null) {
      count(row.object)
      related.add(pairKey(row.subject, row.object))
      if (row.negated === 0 && row.verb === 'ALIAS') {
        aliasParent.set(find(row.subject), find(row.object))
      }
      if (row.negated === 0 && row.verb !== 'ALIAS') {
        neighbor(row.subject, `out ${row.verb} ${row.object}`)
        neighbor(row.object, `in ${row.subject} ${row.verb}`)
      }
    }
    // Only textual values long enough to be distinctive can identify —
    // two entities measuring alike (`floors: 2`) are not one entity.
    if (row.negated === 0 && row.attribute !== null && row.value_num === null &&
        row.value_text !== null && row.value_text.length >= 4) {
      const key = [row.attribute, row.value_text, row.value_unit ?? ''].join('\n')
      values.set(key, (values.get(key) ?? new Set()).add(row.subject))
    }
  }
  const decided = new Set(
    (store.db.prepare(
      "SELECT DISTINCT subject, object FROM cave_claim WHERE verb = 'ALIAS' AND object IS NOT NULL"
    ).all() as { subject: string, object: string }[])
      .map(row => pairKey(row.subject, row.object))
  )
  const closureRoot = new Map([...counts.keys()].map(name => [name, find(name)]))
  return { counts, neighbors, values, related, decided, closureRoot }
}

/** String and shared-value signals — the candidate-generating evidence (spec §27.2). */
const primarySignals = (a: string, b: string, graph: Graph): Signal[] => {
  const signals: Signal[] = []
  const [na, nb] = [norm(a), norm(b)]
  if (na === nb) {
    signals.push({ kind: 'equal', score: 1, detail: 'names equal ignoring case and separators' })
  } else {
    const [ta, tb] = [tokensOf(a), tokensOf(b)]
    const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta]
    const subset = [...small].every(token => large.has(token))
    if (subset && ta.size === tb.size) {
      signals.push({ kind: 'tokens', score: 0.9, detail: 'same name segments, reordered' })
    } else if (subset && Math.min(na.length, nb.length) >= 3) {
      const [short, long] = ta.size <= tb.size ? [a, b] : [b, a]
      signals.push({ kind: 'tokens', score: 0.7, detail: `segments of ${short} within ${long}` })
    }
    if (!digitOnlyDifference(na, nb)) {
      const [short, long] = na.length <= nb.length ? [a, b] : [b, a]
      if (Math.min(na.length, nb.length) >= 4 && (na.startsWith(nb) || nb.startsWith(na))) {
        signals.push({
          kind: 'prefix',
          score: Math.min(na.length, nb.length) / Math.max(na.length, nb.length),
          detail: `${short} prefixes ${long}`
        })
      }
      if (Math.min(na.length, nb.length) >= 5 && leftoverDrift(a, b)) {
        const similarity = 1 - editDistance(na, nb) / Math.max(na.length, nb.length)
        if (similarity >= 0.75) {
          signals.push({ kind: 'edit', score: similarity, detail: `spelling ${Math.round(similarity * 100)}% similar` })
        }
      }
    }
  }
  for (const [key, names] of graph.values) {
    // Exactly the two candidates — a value shared more widely is a common
    // category value (`status: active`), not an identity.
    if (names.size === 2 && names.has(a) && names.has(b)) {
      const [attribute, value, unit] = key.split('\n') as [string, string, string]
      const shown = value.length > 40 ? `${value.slice(0, 40)}...` : value
      signals.push({ kind: 'value', score: 0.8, detail: `share ${attribute}: ${shown}${unit === '' ? '' : ` ${unit}`}` })
      if (signals.filter(signal => signal.kind === 'value').length >= 2) {
        break
      }
    }
  }
  return signals
}

/** Shared relation neighbors — evidence that boosts, never generates (spec §27.2). */
const neighborSignals = (a: string, b: string, graph: Graph): Signal[] => {
  const from = graph.neighbors.get(a)
  const other = graph.neighbors.get(b)
  if (from === undefined || other === undefined) {
    return []
  }
  const signals: Signal[] = []
  for (const signature of from) {
    if (other.has(signature)) {
      const [side, first, second] = signature.split(' ') as [string, string, string]
      signals.push({
        kind: 'neighbor',
        score: 0.1,
        detail: side === 'out' ? `both ${first} ${second}` : `both object of ${first} ${second}`
      })
      if (signals.length >= 2) {
        break
      }
    }
  }
  return signals
}

const formatPercent = (confidence: number): string =>
  `${Math.round(confidence * 100)}%`

/**
 * Proposes same-entity candidates over current beliefs (spec §27),
 * strongest first. Deterministic: string similarity and shared rare
 * attribute values generate candidates, shared relation neighbors boost
 * them, and every excluded pair stays excluded — recorded `ALIAS` history
 * in either direction (merged, rejected or unmerged), membership in one
 * §13.6 closure group, a direct claim relating the two (related entities
 * are distinct entities), or a scope-parent name (`auth` names a scope of
 * `auth/middleware`, not an alias).
 */
export const suggestAliases = (store: Store, options: Options = {}): Suggestion[] => {
  const minScore = options.minScore ?? defaultMinScore
  const graph = readGraph(store)
  const names = [...graph.counts.keys()].sort()
  // Cheap blocking: a pair is worth scoring when the names share their
  // first comparison character, a normalized suffix, a segment, or a rare
  // value. The suffix block lets leading-character edits reach the existing
  // edit-distance and differing-segment guards.
  const blocks = new Map<string, string[]>()
  const block = (key: string, name: string): void => {
    blocks.set(key, [...blocks.get(key) ?? [], name])
  }
  for (const name of names) {
    const normalized = norm(name)
    block(`first ${normalized[0]!}`, name)
    if (normalized.length >= 5) {
      block(`suffix ${normalized.slice(-4)}`, name)
    }
    for (const token of tokensOf(name)) {
      block(`token ${token}`, name)
    }
  }
  for (const [key, carriers] of graph.values) {
    if (carriers.size === 2) {
      for (const name of carriers) {
        if (graph.counts.has(name)) {
          block(`value ${key}`, name)
        }
      }
    }
  }
  const excluded = (a: string, b: string): boolean => {
    const key = pairKey(a, b)
    return graph.decided.has(key) || graph.related.has(key) ||
      graph.closureRoot.get(a) === graph.closureRoot.get(b) ||
      a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
  }
  const seen = new Set<string>()
  const suggestions: Suggestion[] = []
  for (const bucket of blocks.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const [a, b] = [bucket[i]!, bucket[j]!]
        const key = pairKey(a, b)
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        if (excluded(a, b)) {
          continue
        }
        const primary = primarySignals(a, b, graph)
        if (primary.length === 0) {
          continue
        }
        const boosts = neighborSignals(a, b, graph)
        const score = Math.min(1,
          Math.max(...primary.map(signal => signal.score)) +
          boosts.reduce((sum, signal) => sum + signal.score, 0))
        if (score < minScore) {
          continue
        }
        // The more-established name is canonical: more current rows, then
        // the shorter name, then lexicographic — a convention, not a
        // semantic (§13.6 reads ALIAS as undirected).
        const countOf = (name: string): number => graph.counts.get(name) ?? 0
        const canonicalFirst = countOf(a) !== countOf(b) ?
          countOf(a) > countOf(b) :
          a.length !== b.length ? a.length < b.length : a < b
        const [entity, canonical] = canonicalFirst ? [b, a] : [a, b]
        const signals = [...primary, ...boosts]
        const confidence = Math.min(0.5, Math.max(0.3, Math.round(score * 50) / 100))
        suggestions.push({
          entity,
          canonical,
          score,
          confidence,
          signals,
          line: `${entity} ALIAS ${canonical} #${suggestTag} @ ${formatPercent(confidence)}` +
            ` ; ${signals.map(signal => signal.detail).join('; ')}`
        })
      }
    }
  }
  suggestions.sort((a, b) =>
    b.score - a.score || a.entity.localeCompare(b.entity) || a.canonical.localeCompare(b.canonical))
  return options.limit === undefined ? suggestions : suggestions.slice(0, options.limit)
}

/**
 * Appends suggestions as claims, stamped `@src:suggest/alias` (spec §9.5,
 * §27.3). Once written, a pair has `ALIAS` history and is never suggested
 * again — re-runs are naturally idempotent. Note the §13.6 consequence: a
 * positive claim at any confidence links the alias closure; belief is
 * graded, and review (confirm or retract) is the follow-up.
 */
export const writeSuggestions = (store: Store, suggestions: readonly Suggestion[]): { appended: number } =>
  suggestions.length === 0 ?
    { appended: 0 } :
    {
      appended: store.ingest(
        suggestions.map(suggestion => suggestion.line).join('\n'),
        { source: suggestSource, strict: true }
      ).ids.length
    }

/** Current claims naming the entity, newest first — the judge's evidence. */
const evidenceOf = (store: Store, entity: string, limit: number): string[] =>
  (store.db.prepare(`
    SELECT c.raw_line AS line FROM (${currentSql}) c
    WHERE c.conf > 0 AND (c.subject = ? OR c.object = ?)
    ORDER BY c.tx DESC LIMIT ?
  `).all(entity, entity, limit) as { line: string }[]).map(row => row.line)

/**
 * The judge prompt (spec §27.4): every suggestion with its evidence and
 * each side's current claims. The reply contract is one JSON array of the
 * suggestion numbers that really are the same entity.
 */
export const judgePrompt = (store: Store, suggestions: readonly Suggestion[]): string => [
  'You are reviewing entity-alias suggestions for a CAVE knowledge store — one atomic claim',
  'per line: subject VERB object, or subject HAS attribute: value, with optional @context,',
  '#tag and @ N% confidence.',
  '',
  'Each numbered suggestion proposes that two names denote the SAME real-world entity.',
  'Below each suggestion are the current claims about either name. Confirm a suggestion ONLY',
  'when the claims are consistent with one entity — tolerate spelling, casing and phrasing',
  'drift, but never confirm names whose claims describe different things (different types,',
  'contradicting values, distinct roles in the same relation). Judge conservatively: when',
  'unsure, do not confirm.',
  '',
  ...suggestions.flatMap((suggestion, index) => [
    `S${index + 1}: ${suggestion.line}`,
    ...evidenceOf(store, suggestion.entity, 8).map(line => `  ${line}`),
    ...evidenceOf(store, suggestion.canonical, 8).map(line => `  ${line}`),
    ''
  ]),
  'Reply with ONLY a JSON array of the suggestion numbers that ARE the same entity,',
  'e.g. [1, 3]. Reply [] when none are.'
].join('\n')

/**
 * Parses the judge's reply into validated 0-based suggestion indices. The
 * *last* well-formed JSON array wins (agents often think aloud before
 * answering); non-integer, out-of-range and duplicate entries are dropped
 * rather than failing the run.
 */
export const parseJudgeReply = (output: string, count: number): number[] => {
  let parsed: unknown
  let at = output.indexOf('[')
  while (at !== -1) {
    const end = output.indexOf(']', at)
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
  const kept = new Set<number>()
  for (const entry of parsed) {
    if (typeof entry === 'number' && Number.isInteger(entry) && entry >= 1 && entry <= count) {
      kept.add(entry - 1)
    }
  }
  return [...kept].sort((a, b) => a - b)
}
