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

import { lastJsonArray } from '@cavelang/loop'
import { canonicalizeText, emitClaim } from '@cavelang/canonical'
import { readSnapshot } from './snapshot.ts'
import { Claim, Verb } from '@cavelang/core'
import { QuerySql, Row } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import { aliasRoot } from './alias-root.ts'
import { distanceWithin } from './edit-distance.ts'

const currentSql = QuerySql.current()

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
  /** The less-established name; normally the subject of the suggested claim. */
  readonly entity: string
  /** The more-established name; normally the object of the suggested claim. */
  readonly canonical: string
  /** Combined evidence score in 0..1 (spec §27.2). */
  readonly score: number
  /** `score / 2`, clamped to 0.3..0.5 — the §20.2 review band. */
  readonly confidence: number
  readonly signals: readonly Signal[]
  /** The suggested claim as CAVE text; the undirected relation may reverse to preserve entity identity. */
  readonly line: string
}

export type Options = {
  /** Finite minimum evidence score in 0..1 (spec §27.2), default {@link defaultMinScore}. */
  readonly minScore?: number
  /** Positive safe integer; at most this many suggestions, strongest first. */
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
type ComparisonName = {
  readonly name: string
  readonly normalized: string
  readonly digitless: string
  readonly tokens: ReadonlySet<string>
}

const editSimilarity = (a: string, b: string): number => {
  const length = Math.max(a.length, b.length)
  if (length === 0) return 1
  // Only similarities >= 0.75 can contribute a signal or pass the drift guard.
  const distance = distanceWithin(a, b, Math.floor(length / 4))
  return distance === undefined ? 0 : 1 - distance / length
}

/**
 * Whether the segments the names do NOT share are themselves spelling
 * variants (edit similarity ≥ 0.75). Distinguishes drift (`grandma-mria` /
 * `grandma-maria`) from sibling naming (`north-tower` / `south-tower`) —
 * whole-string similarity alone cannot tell a typo from a differing word.
 */
const leftoverDrift = (ta: ReadonlySet<string>, tb: ReadonlySet<string>): boolean => {
  const leftA = [...ta].filter(token => !tb.has(token))
  const leftB = [...tb].filter(token => !ta.has(token))
  if (leftA.length === 0 || leftB.length === 0) {
    return true
  }
  const [small, large] = leftA.length <= leftB.length ? [leftA, leftB] : [leftB, leftA]
  return small.every(token =>
    large.some(other => editSimilarity(token, other) >= 0.75))
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
  /** JSON attribute/value/unit tuple → carriers (textual values ≥ 4 chars only). */
  readonly values: Map<string, Set<string>>
  /** Order-free pair identity → at most two rare-value signals. */
  readonly valueSignals: Map<string, Signal[]>
  /** Pairs connected by any current claim — related entities are distinct. */
  readonly related: Set<string>
  /** Pairs decided by any recorded `ALIAS` row, whatever its state. */
  readonly decided: Set<string>
  /** Name → alias-closure root over current positive `ALIAS` links. */
  readonly closureRoot: Map<string, string>
}

const readGraph = (store: Store): Graph => {
  return readSnapshot(store, 'cave_alias_discovery', () => readGraphSnapshot(store))
}

const readGraphSnapshot = (store: Store): Graph => {
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
  const find = (name: string): string => aliasRoot(aliasParent, name)
  for (const row of rows) {
    count(row.subject)
    if (row.object !== null) {
      count(row.object)
      related.add(pairKey(row.subject, row.object))
      if (row.negated === 0 && row.verb === 'ALIAS') {
        aliasParent.set(find(row.subject), find(row.object))
      }
      if (row.negated === 0 && row.verb !== 'ALIAS') {
        neighbor(row.subject, JSON.stringify(['out', row.verb, row.object]))
        neighbor(row.object, JSON.stringify(['in', row.subject, row.verb]))
      }
    }
    // Only textual values long enough to be distinctive can identify —
    // two entities measuring alike (`floors: 2`) are not one entity.
    if (row.negated === 0 && row.attribute !== null && row.value_num === null &&
        row.value_text !== null && row.value_text.length >= 4) {
      const kind = Row.parseValue(row.value_text).kind
      if (kind === 'number' || kind === 'trajectory') continue
      const key = JSON.stringify([row.attribute, row.value_text, row.value_unit ?? ''])
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
  const valueSignals = new Map<string, Signal[]>()
  for (const [key, names] of values) {
    // Exactly two carriers — a value shared more widely is a common
    // category value (`status: active`), not an identity.
    if (names.size === 2) {
      const [a, b] = [...names] as [string, string]
      const pair = pairKey(a, b)
      const signals = valueSignals.get(pair) ?? []
      if (signals.length >= 2) continue
      const [attribute, value, unit] = JSON.parse(key) as [string, string, string]
      const shown = value.length > 40 ? `${value.slice(0, 40)}...` : value
      signals.push({ kind: 'value', score: 0.8, detail: `share ${attribute}: ${shown}${unit === '' ? '' : ` ${unit}`}` })
      valueSignals.set(pair, signals)
    }
  }
  return { counts, neighbors, values, valueSignals, related, decided, closureRoot }
}

/** String and shared-value signals — the candidate-generating evidence (spec §27.2). */
const primarySignals = (left: ComparisonName, right: ComparisonName, graph: Graph): Signal[] => {
  const signals: Signal[] = []
  const { name: a, normalized: na, tokens: ta } = left
  const { name: b, normalized: nb, tokens: tb } = right
  if (na === nb) {
    signals.push({ kind: 'equal', score: 1, detail: 'names equal ignoring case and separators' })
  } else {
    const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta]
    const subset = [...small].every(token => large.has(token))
    if (subset && ta.size === tb.size) {
      signals.push({ kind: 'tokens', score: 0.9, detail: 'same name segments, reordered' })
    } else if (subset && Math.min(na.length, nb.length) >= 3) {
      const [short, long] = ta.size <= tb.size ? [a, b] : [b, a]
      signals.push({ kind: 'tokens', score: 0.7, detail: `segments of ${short} within ${long}` })
    }
    if (left.digitless !== right.digitless) {
      const [short, long] = na.length <= nb.length ? [a, b] : [b, a]
      if (Math.min(na.length, nb.length) >= 4 && (na.startsWith(nb) || nb.startsWith(na))) {
        signals.push({
          kind: 'prefix',
          score: Math.min(na.length, nb.length) / Math.max(na.length, nb.length),
          detail: `${short} prefixes ${long}`
        })
      }
      if (Math.min(na.length, nb.length) >= 5 && leftoverDrift(ta, tb)) {
        const similarity = editSimilarity(na, nb)
        if (similarity >= 0.75) {
          signals.push({ kind: 'edit', score: similarity, detail: `spelling ${Math.round(similarity * 100)}% similar` })
        }
      }
    }
  }
  signals.push(...graph.valueSignals.get(pairKey(a, b)) ?? [])
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
      const [side, first, second] = JSON.parse(signature) as [string, string, string]
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

/** ALIAS is undirected; prefer the conventional order when it is representable. */
const suggestionLine = (entity: string, canonical: string, confidence: number, signals: readonly Signal[]): string => {
  const render = (subject: string, object: string) => emitClaim(Claim.of({
    subject: Claim.entity(subject), verb: 'ALIAS', payload: Claim.relation(Claim.entity(object)),
    conf: confidence, tags: [{ key: suggestTag }], comment: signals.map(signal => signal.detail).join('; ')
  }))
  try { return render(entity, canonical) }
  catch (forwardError) {
    if (!(forwardError instanceof TypeError)) throw forwardError
    try { return render(canonical, entity) }
    catch (reverseError) {
      if (!(reverseError instanceof TypeError)) throw reverseError
      throw new Error(`CAVE cannot represent an alias relation between ${JSON.stringify(entity)} and ${JSON.stringify(canonical)} in either direction; no suggestions were written`,
        { cause: new AggregateError([forwardError, reverseError], 'Neither alias orientation preserves entity payload identity') })
    }
  }
}

type Candidate = Omit<Suggestion, 'line'>

const suggestionCollector = (limit: number | undefined) => {
  const compareValues = (a: Candidate, b: Candidate): number =>
    b.score - a.score || a.entity.localeCompare(b.entity) || a.canonical.localeCompare(b.canonical)
  if (limit === undefined) {
    const all: Candidate[] = []
    return { add: (value: Candidate): void => { all.push(value) }, finish: (): Candidate[] => all.sort(compareValues) }
  }
  type Ranked = { value: Candidate, order: number }
  const retained: Ranked[] = []
  let order = 0
  const compare = (a: Ranked, b: Ranked): number =>
    compareValues(a.value, b.value) || a.order - b.order
  const swap = (a: number, b: number): void => {
    const value = retained[a]!
    retained[a] = retained[b]!
    retained[b] = value
  }
  return {
    add(value: Candidate): void {
      const entry = { value, order: order++ }
      // A max-heap keeps the worst retained candidate at the root.
      if (retained.length < limit) {
        retained.push(entry)
        let at = retained.length - 1
        while (at > 0) {
          const parent = Math.floor((at - 1) / 2)
          if (compare(retained[at]!, retained[parent]!) <= 0) break
          swap(at, parent)
          at = parent
        }
        return
      }
      if (compare(entry, retained[0]!) >= 0) return
      retained[0] = entry
      let at = 0
      while (2 * at + 1 < retained.length) {
        let child = 2 * at + 1
        if (child + 1 < retained.length && compare(retained[child + 1]!, retained[child]!) > 0) child++
        if (compare(retained[at]!, retained[child]!) >= 0) break
        swap(at, child)
        at = child
      }
    },
    finish: (): Candidate[] => retained.sort(compare).map(entry => entry.value)
  }
}

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
  const limit = options.limit
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
    throw new TypeError('minScore must be finite and between 0 and 1')
  }
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new TypeError('limit must be a positive safe integer')
  }
  const graph = readGraph(store)
  const names = [...graph.counts.keys()].sort()
  const comparisons = new Map(names.map(name => {
    const normalized = norm(name)
    return [name, { name, normalized, digitless: stripDigits(normalized), tokens: tokensOf(name) }]
  }))
  // Cheap blocking: a pair is worth scoring when the names share their
  // first comparison character, a normalized suffix, a segment, or a rare
  // value. The suffix block lets leading-character edits reach the existing
  // edit-distance and differing-segment guards.
  const blocks = new Map<string, { id: number, names: string[] }>()
  const memberships = new Map<string, Set<number>>()
  const block = (key: string, name: string): void => {
    const bucket = blocks.get(key) ?? { id: blocks.size, names: [] }
    bucket.names.push(name)
    blocks.set(key, bucket)
    const member = memberships.get(name) ?? new Set<number>()
    member.add(bucket.id)
    memberships.set(name, member)
  }
  for (const name of names) {
    const { normalized, tokens } = comparisons.get(name)!
    block(`first ${normalized[0]!}`, name)
    if (normalized.length >= 5) {
      block(`suffix ${normalized.slice(-4)}`, name)
    }
    for (const token of tokens) {
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
  const suggestions = suggestionCollector(limit)
  for (const { id, names: bucket } of blocks.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const [a, b] = [bucket[i]!, bucket[j]!]
        // The first shared block owns the pair. Remembering memberships
        // avoids retaining a separate key for every candidate pair.
        const left = memberships.get(a)!
        const right = memberships.get(b)!
        let earlier = false
        for (const shared of left) {
          if (shared < id && right.has(shared)) { earlier = true; break }
        }
        if (earlier) {
          continue
        }
        if (excluded(a, b)) {
          continue
        }
        const primary = primarySignals(comparisons.get(a)!, comparisons.get(b)!, graph)
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
        suggestions.add({
          entity,
          canonical,
          score,
          confidence,
          signals
        })
      }
    }
  }
  return suggestions.finish().map(candidate => ({ ...candidate,
    line: suggestionLine(candidate.entity, candidate.canonical, candidate.confidence, candidate.signals)
  }))
}

/**
 * Appends suggestions as claims, stamped `@src:suggest/alias` (spec §9.5,
 * §27.3). Once written, a pair has `ALIAS` history and is never suggested
 * again. Recheck both directions of pair history under the write reservation,
 * including retained suggestions that awaited an external judge; reviewed
 * pairs and duplicate input pairs are skipped. Note the §13.6 consequence: a
 * positive claim at any confidence links the alias closure; belief is
 * graded, and review (confirm or retract) is the follow-up.
 */
export const writeSuggestions = (store: Store, suggestions: readonly Suggestion[]): { appended: number } =>
  suggestions.length === 0 ?
    { appended: 0 } :
    store.transaction(() => {
      const history = store.db.prepare(`
        SELECT 1 FROM cave_claim WHERE verb = 'ALIAS' AND
          ((subject = ? AND object = ?) OR (subject = ? AND object = ?)) LIMIT 1
      `)
      const seen = new Set<string>()
      const fresh = suggestions.map(({ entity, canonical, line }) => ({ entity, canonical, line })).filter(({ entity, canonical }) => {
        const key = pairKey(entity, canonical)
        if (seen.has(key)) return false
        seen.add(key)
        return history.get(entity, canonical, canonical, entity) === undefined
      })
      if (fresh.length === 0) return { appended: 0 }
      const registry = store.registry()
      const lines: string[] = []
      for (const suggestion of fresh) {
        const parsed = canonicalizeText(suggestion.line, registry)
        const claim = parsed.claims[0]?.claim
        if (parsed.problems.length > 0 || parsed.claims.length !== 1 || parsed.edges.length !== 0 ||
            claim?.verb !== 'ALIAS' || claim.negated || !(claim.conf > 0) ||
            claim.subject.kind !== 'entity' || claim.payload.kind !== 'relation' ||
            claim.payload.object.kind !== 'entity' ||
            !((claim.subject.text === suggestion.entity && claim.payload.object.text === suggestion.canonical) ||
              (claim.subject.text === suggestion.canonical && claim.payload.object.text === suggestion.entity))) {
          throw new Error(`CAVE suggestion must encode one positive alias relation between ${JSON.stringify(suggestion.entity)} and ${JSON.stringify(suggestion.canonical)}; no suggestions were appended`)
        }
        // A line valid in isolation may carry indentation that groups it under
        // the preceding suggestion when joined. Emit each as an independent claim.
        lines.push(emitClaim(claim))
      }
      return {
        appended: store.ingest(
          lines.join('\n'),
          { source: suggestSource, strict: true }
        ).ids.length
      }
    })

/** Current claims naming the entity, newest first — the judge's evidence. */
const evidenceOf = (store: Store, entity: string, limit: number): string[] =>
  (store.db.prepare(`
    SELECT c.raw_line AS line FROM (${currentSql}) c
    WHERE c.conf > 0 AND (c.subject = ? OR c.object = ?)
    ORDER BY c.tx DESC LIMIT ?
  `).all(entity, entity, limit) as { line: string }[]).map(row => row.line)

type JudgeCandidate = Pick<Suggestion, 'entity' | 'canonical' | 'line'>

/**
 * The judge prompt (spec §27.4): every suggestion with its evidence and
 * each side's current claims. The reply contract is one JSON array of the
 * suggestion numbers that really are the same entity.
 */
export const judgePrompt = (store: Store, suggestions: readonly Suggestion[]): string => {
  const captured = suggestions.map(({ entity, canonical, line }) => ({ entity, canonical, line }))
  if (captured.length === 0) return readJudgePrompt(store, captured)
  return readSnapshot(store, 'cave_alias_judge', () => readJudgePrompt(store, captured))
}

const readJudgePrompt = (store: Store, suggestions: readonly JudgeCandidate[]): string => [
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
  const parsed = lastJsonArray(output)
  if (parsed === undefined) return []
  const kept = new Set<number>()
  for (const entry of parsed) {
    if (typeof entry === 'number' && Number.isInteger(entry) && entry >= 1 && entry <= count) {
      kept.add(entry - 1)
    }
  }
  return [...kept].sort((a, b) => a - b)
}
