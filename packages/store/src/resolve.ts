/**
 * Contradiction resolution (spec §26) — the explicit, configurable policy
 * that picks one winner per fact among coexisting current beliefs.
 *
 * §9.4 tolerates contradictions at write time; §9.5 actor stamps, content
 * sources, negation and aliased names (§13.6) all fork belief series about
 * one fact on purpose. Latest-tx resolves *within* a series; this module
 * resolves *across* them:
 *
 * - the **resolution group** of a current row is its claim key with every
 *   `src:` context removed and the negation flag dropped (§26.1) —
 *   sources say who asserted a fact, polarity is the contest;
 * - **candidates** are the current row of each series in the group,
 *   excluding retracted rows (`@ 0%` neither wins nor blocks);
 * - the **winner** compares precedence class (max over the row's
 *   sources), then reliability-weighted confidence (min over sources),
 *   then latest tx (§26.2);
 * - the policy is declared **in-band** as `source/<name> HAS precedence:`
 *   / `HAS reliability:` claims matched to `src:` contexts by longest
 *   path prefix (§26.3), over the built-in ladder below. Policy claims
 *   themselves resolve under the built-ins alone — bootstrapping ends
 *   there, so an ingested document can never elevate its own batch above
 *   the humans and agents it is answerable to.
 *
 * Resolution is a read mode: nothing is rewritten, the winner is a stored
 * row returned verbatim.
 */

import type { Database } from './adapter.ts'
import type * as Row from './row.ts'

/** One effective policy entry (spec §26.3). */
export type Entry = {
  /**
   * `source/`-relative path the entry covers by whole-segment prefix:
   * `''` is the root (every source, and rows with no source), `'cli'`,
   * `'agent'`, `'ingest/93a0'`. The most specific match of each
   * dimension applies.
   */
  readonly prefix: string
  /** Precedence class — higher outranks (spec §26.2). */
  readonly precedence?: number
  /** Reliability weight `0..1` multiplying stored confidence (spec §26.2). */
  readonly reliability?: number
}

/** A current row scored and ranked inside its resolution group. */
export type Ranked = Row.t & {
  /** The resolution group key (claim key modulo `src:` contexts and polarity). */
  readonly res_group: string
  /** Precedence class of the row's sources (spec §26.2). */
  readonly res_class: number
  /** Reliability-weighted confidence — ranks, never rewrites `conf`. */
  readonly res_conf: number
  /** 1 = the group's winner. */
  readonly res_rank: number
}

/** A fact more than one series currently speaks about (spec §26.4). */
export type Contested = {
  /** The resolution group key. */
  readonly group: string
  /** Candidates ranked by the policy — the winner first. */
  readonly rows: readonly Ranked[]
}

/**
 * The built-in default ladder (spec §26.3): human corrections outrank
 * agent writes, which outrank source material (content sources,
 * `connect`, `ingest`, unstamped rows), which outranks derived claims.
 * Overridable by declaring the same subject in-band.
 */
export const builtins: readonly Entry[] = [
  { prefix: '', precedence: 2 },
  { prefix: 'cli', precedence: 4 },
  { prefix: 'agent', precedence: 3 },
  { prefix: 'action', precedence: 3 },
  { prefix: 'rule', precedence: 1 }
]

/** Whole-`/`-segment prefix match: `''` covers everything (spec §26.3). */
const covers = (path: string, prefix: string): boolean =>
  prefix === '' || path === prefix || path.startsWith(`${prefix}/`)

/** Most specific entry carrying `dimension` that covers `path`. */
const lookup = (entries: readonly Entry[], path: string, dimension: 'precedence' | 'reliability'): undefined | number => {
  let best: undefined | Entry
  for (const entry of entries) {
    if (entry[dimension] !== undefined && covers(path, entry.prefix) &&
        (best === undefined || entry.prefix.length > best.prefix.length)) {
      best = entry
    }
  }
  return best?.[dimension]
}

const rootOf = (entries: readonly Entry[], dimension: 'precedence' | 'reliability'): undefined | number =>
  entries.find(entry => entry.prefix === '')?.[dimension]

/**
 * Precedence class of a row's source paths under `entries` — max over
 * sources, the root class when unsourced (spec §26.2).
 */
const classOf = (entries: readonly Entry[], paths: readonly string[]): number => {
  const root = rootOf(entries, 'precedence') ?? 0
  return paths.length === 0 ?
    root :
    Math.max(...paths.map(path => lookup(entries, path, 'precedence') ?? root))
}

type DeclarationRow = {
  readonly id: string
  readonly tx: string
  readonly subject: string
  readonly attribute: string
  readonly value_num: null | number
  readonly value_unit: null | string
  readonly conf: number
}

/**
 * Declared value of a policy row, normalized — `undefined` when it does
 * not parse (such declarations are ignored, spec §26.3): precedence is a
 * bare number; reliability accepts `N%` or bare `0..1`.
 */
const declaredValue = (row: DeclarationRow): undefined | number => {
  if (row.value_num === null || !Number.isFinite(row.value_num)) {
    return undefined
  }
  if (row.attribute === 'precedence') {
    return row.value_unit === null ? row.value_num : undefined
  }
  const value = row.value_unit === '%' ? row.value_num / 100 : row.value_unit === null ? row.value_num : undefined
  return value !== undefined && value >= 0 && value <= 1 ? value : undefined
}

/**
 * Reads the effective resolution policy (spec §26.3): the built-in ladder
 * merged with current positive in-band `source[/<path>] HAS precedence:`
 * / `HAS reliability:` declarations. When several series declare one
 * (subject, dimension) — different actors, per §9.5 — the contest is
 * resolved under the **built-ins alone**: class of the declaring sources,
 * then confidence, then tx.
 *
 * `currentSql` is the current-belief universe to read declarations from —
 * the caller's, so an as-of query reads the policy as of its boundary
 * (§12.3).
 */
export const readPolicy = (db: Database, currentSql: string): Entry[] => {
  const declarations = db.prepare(`
    SELECT c.id, c.tx, c.subject, c.attribute, c.value_num, c.value_unit, c.conf
    FROM (${currentSql}) c
    WHERE c.verb = 'HAS' AND c.negated = 0 AND c.conf > 0
      AND c.attribute IN ('precedence', 'reliability')
      AND (c.subject = 'source' OR substr(c.subject, 1, 7) = 'source/')
  `).all() as unknown as DeclarationRow[]
  const sourcesOf = db.prepare(`
    SELECT CASE WHEN instr(substr(context, 5), '#') = 0 THEN substr(context, 5)
      ELSE substr(substr(context, 5), 1, instr(substr(context, 5), '#') - 1) END AS path
    FROM cave_context
    WHERE claim_id = ? AND substr(context, 1, 4) = 'src:'
  `)

  // One contest per (subject, dimension); unparseable values never compete.
  const contests = new Map<string, { row: DeclarationRow, value: number, cls: number }[]>()
  for (const row of declarations) {
    const value = declaredValue(row)
    if (value === undefined) {
      continue
    }
    const paths = (sourcesOf.all(row.id) as { path: string }[]).map(source => source.path)
    const key = `${row.subject}\0${row.attribute}`
    const candidates = contests.get(key) ?? []
    candidates.push({ row, value, cls: classOf(builtins, paths) })
    contests.set(key, candidates)
  }

  const merged = new Map<string, { prefix: string, precedence?: number, reliability?: number }>(
    builtins.map(entry => [entry.prefix, { ...entry }])
  )
  for (const [key, candidates] of contests) {
    const [subject, attribute] = key.split('\0') as [string, string]
    const winner = candidates.sort((a, b) =>
      b.cls - a.cls || b.row.conf - a.row.conf || (a.row.tx < b.row.tx ? 1 : a.row.tx > b.row.tx ? -1 : 0))[0]!
    const prefix = subject === 'source' ? '' : subject.slice('source/'.length)
    const entry = merged.get(prefix) ?? { prefix }
    entry[attribute as 'precedence' | 'reliability'] = winner.value
    merged.set(prefix, entry)
  }
  return [...merged.values()].sort((a, b) => a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0)
}

const sqlString = (text: string): string =>
  `'${text.replaceAll("'", "''")}'`

const sqlNumber = (value: undefined | number): string =>
  value !== undefined && Number.isFinite(value) ? String(value) : 'NULL'

/** `cave_claim` columns, for projecting helper columns away. */
const claimColumns =
  'id, tx, subject, verb, negated, object, attribute, value_text, value_num, value_unit, value_approx, ' +
  'delta_text, delta_num, delta_unit, sigma_level, conf, importance, comment, raw_line, claim_key'

/**
 * SQL over `currentSql` (a current-belief SELECT, §13.5) scoring and
 * ranking every supported current row inside its resolution group
 * (spec §26.1–§26.2): the row columns plus `res_group`, `res_class`,
 * `res_conf` (reliability-weighted) and `res_rank` (1 = winner).
 *
 * With `aliases`, group keys widen through the alias closure — the
 * caller MUST have an `alias_pair(a, b)` recursive CTE in scope (the
 * §13.6 transitive closure over current positive `ALIAS` edges); entity
 * parts of the key resolve to their closure group's smallest name, for
 * grouping only — returned rows keep their stored spelling.
 */
export const rankedSql = (
  entries: readonly Entry[],
  currentSql: string,
  options: { aliases?: boolean } = {}
): string => {
  const values = entries.map(entry =>
    `(${sqlString(entry.prefix)}, ${sqlNumber(entry.precedence)}, ${sqlNumber(entry.reliability)})`)
  const rootClass = sqlNumber(rootOf(entries, 'precedence') ?? 0)
  const rootReliability = sqlNumber(rootOf(entries, 'reliability') ?? 1)
  // Alias representative: the closure group's smallest member name —
  // stable whichever member the key names (spec §26.1).
  const representative = (expr: string): string =>
    `min(${expr}, COALESCE((SELECT MIN(ap.b) FROM alias_pair ap WHERE ap.a = ${expr}), ${expr}))`
  const subjectPart = `json_extract(c.claim_key, '$[0]')`
  const payloadPart = `json_extract(c.claim_key, '$[3]')`
  const subjectExpr = options.aliases === true ?
    `CASE WHEN substr(${subjectPart}, 1, 2) = 'e:' THEN 'e:' || ${representative(`substr(${subjectPart}, 3)`)} ELSE ${subjectPart} END` :
    subjectPart
  const payloadExpr = options.aliases === true ?
    `CASE WHEN substr(${payloadPart}, 1, 4) = 'r:e:' THEN 'r:e:' || ${representative(`substr(${payloadPart}, 5)`)} ELSE ${payloadPart} END` :
    payloadPart
  // Claim key modulo polarity and src: contexts (spec §26.1). Contexts in
  // the key are already sorted; filtering preserves the order.
  const groupExpr = `json_array(${subjectExpr}, json_extract(c.claim_key, '$[1]'), ${payloadExpr}, ` +
    `COALESCE((SELECT json_group_array(e.value ORDER BY e.value) FROM json_each(c.claim_key, '$[4]') e ` +
    `WHERE substr(e.value, 1, 4) <> 'src:'), json_array()))`
  // Physical sources always participate. An actor participates only when
  // its compatibility stamp is part of this row's claim identity; this
  // preserves the §9.5 rule that an authored source suppresses an ordinary
  // caller stamp while lifecycle stamps remain mandatory.
  const paths = `SELECT p.value AS path FROM cave_provenance p WHERE p.claim_id = c.id AND (` +
    `p.dimension = 'source' OR (p.dimension = 'actor' AND EXISTS (` +
    `SELECT 1 FROM cave_context pc WHERE pc.claim_id = c.id AND pc.context = 'src:' || p.value)))`
  // Longest-prefix match of one source path against the policy (spec §26.3).
  const matched = (column: string): string =>
    `(SELECT y.${column} FROM cave_policy y WHERE y.${column} IS NOT NULL AND ` +
    `(y.prefix = '' OR x.path = y.prefix OR substr(x.path, 1, length(y.prefix) + 1) = y.prefix || '/') ` +
    `ORDER BY length(y.prefix) DESC LIMIT 1)`
  const classExpr = `COALESCE((SELECT MAX(${matched('cls')}) FROM (${paths}) x), ${rootClass})`
  const reliabilityExpr = `COALESCE((SELECT MIN(${matched('rel')}) FROM (${paths}) x), ${rootReliability})`
  const order = `${classExpr} DESC, c.conf * ${reliabilityExpr} DESC, c.tx DESC`
  return `
WITH cave_policy(prefix, cls, rel) AS (VALUES ${values.join(', ')})
SELECT c.*, ${groupExpr} AS res_group, ${classExpr} AS res_class, c.conf * ${reliabilityExpr} AS res_conf,
  ROW_NUMBER() OVER (PARTITION BY ${groupExpr} ORDER BY ${order}) AS res_rank
FROM (${currentSql}) c
WHERE c.conf > 0`
}

/**
 * SQL for the resolved universe (spec §26.4): one winner row per
 * resolution group, plain `cave_claim` columns. Same `aliases` contract
 * as {@link rankedSql}.
 */
export const resolvedSql = (
  entries: readonly Entry[],
  currentSql: string,
  options: { aliases?: boolean } = {}
): string =>
  `SELECT ${claimColumns} FROM (${rankedSql(entries, currentSql, options)}) WHERE res_rank = 1`
