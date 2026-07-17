/**
 * Verbs (spec §5).
 *
 * Verbs are uppercase atoms. Two bootstrap verbs (`IS`, `HAS`) can define
 * everything else in-band; the standard set below exists for graph quality.
 * Extension verbs (spec §5.4) and inverse declarations (spec §5.5 `REVERSE`)
 * are ordinary claims, not syntax — this module only knows the lexical shape
 * and the standard vocabulary.
 */

export type Verb = string

export type t = Verb

/** Bootstrap verbs (spec §5.1). */
export const bootstrap = ['IS', 'HAS'] as const

/** Identity and taxonomy (spec §5.2). */
export const identity = ['IS', 'EXTENDS', 'ALIAS', 'LIKE', 'EXISTS'] as const

/** Causation and change (spec §5.2). */
export const causation = ['CAUSE', 'FIX', 'BECOMES'] as const

/** Dependency and production (spec §5.2). */
export const dependency = ['NEEDS', 'USES', 'YIELDS', 'ENABLES', 'BLOCKS'] as const

/** Structure and ordering (spec §5.2). */
export const structure = ['CONTAINS', 'PRECEDES', 'VS'] as const

/** Canonical verbs for qualifier comparisons (spec §8.2). */
export const comparison = [
  'EXCEEDS', 'IS-BELOW', 'IS-AT-LEAST', 'IS-AT-MOST', 'EQUALS', 'DIFFERS-FROM'
] as const

/** Qualifier verbs — appear indented under another claim (spec §5.2, §8.2). */
export const qualifiers = ['WHEN', 'UNLESS', 'VIA', 'BECAUSE'] as const

export type Qualifier = (typeof qualifiers)[number]

/** The inverse-declaration verb (spec §5.5). */
export const REVERSE = 'REVERSE'

/** The verb-lifecycle declaration (spec §5.8). */
export const RENAMED_TO = 'RENAMED-TO'

/** The shape-expectation meta-verb (spec §20.1). */
export const EXPECTS = 'EXPECTS'

/** The standard inverse names (spec §5.5's declaration block). */
export const standardInverses = [
  'PART-OF', 'CAUSED-BY', 'FOLLOWS', 'USED-BY',
  'NEEDED-BY', 'ENABLED-BY', 'BLOCKED-BY', 'EXTENDED-BY'
] as const

/** All standard relational verbs (qualifiers excluded). */
export const standard: readonly Verb[] = [
  ...identity,
  ...causation,
  ...dependency,
  ...structure,
  ...comparison
]

const standardSet = new Set<string>(standard)
const qualifierSet = new Set<string>(qualifiers)
const knownSet = new Set<string>([...standard, 'HAS', REVERSE, RENAMED_TO, EXPECTS, ...standardInverses])

/**
 * @returns `true` if `s` has the lexical shape of a verb — an uppercase atom:
 * uppercase letters and internal `-` (spec §16 `uppercase_atom`).
 */
export const isVerbToken = (s: string): boolean =>
  /^[A-Z](?:[A-Z-]*[A-Z])?$/.test(s)

/** @returns `true` if `v` is one of the standard relational verbs. */
export const isStandard = (v: string): boolean =>
  standardSet.has(v)

/** @returns `true` if `v` is a qualifier verb (`WHEN`, `UNLESS`, `VIA`, `BECAUSE`). */
export const isQualifier = (v: string): v is Qualifier =>
  qualifierSet.has(v)

/**
 * @returns `true` if `v` belongs to the known standard vocabulary —
 * standard verbs, `HAS`, `REVERSE`, `RENAMED-TO`, `EXPECTS`, and the standard §5.5
 * inverse names.
 * Used by the parser's indentation tiebreak: `USES JWT` is a continuation
 * (JWT is not a known verb) while `API NEEDS auth` is a full triple.
 */
export const isKnown = (v: string): boolean =>
  knownSet.has(v)
