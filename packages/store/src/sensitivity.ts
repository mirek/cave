/**
 * Sensitivity labels and row visibility (spec §9.7).
 *
 * Claims opt into a level with `#sensitivity:<level>`. Unlabelled rows are
 * `internal`; malformed, flat, or unknown labels fail closed as `restricted`.
 * Several labels on one row resolve to the most restrictive one.
 */

export const levels = ['public', 'internal', 'confidential', 'restricted'] as const
export type Level = (typeof levels)[number]

export const defaultLevel: Level = 'internal'
export const defaultMaximum: Level = 'internal'

export const parse = (value: string): undefined | Level =>
  levels.includes(value as Level) ? value as Level : undefined

export const rank = (level: Level): number => levels.indexOf(level)

/**
 * SQL predicate that allows rows at or below `maximum`. `alias` must be a
 * trusted SQL identifier supplied by CAVE code, never user input.
 */
export const sql = (alias: string, maximum: Level = defaultMaximum): string =>
  `COALESCE((SELECT MAX(CASE s.value ` +
  `WHEN 'public' THEN 0 WHEN 'internal' THEN 1 WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3 ELSE 3 END) ` +
  `FROM cave_tag s WHERE s.claim_id = ${alias}.id AND s.key = 'sensitivity'), ${rank(defaultLevel)}) <= ${rank(maximum)}`

/** Most restrictive recognized label; malformed labels are `restricted`. */
export const ofTags = (tags: readonly { key: string, value?: null | string }[]): Level => {
  let effective: undefined | Level
  for (const tag of tags) {
    if (tag.key !== 'sensitivity') {
      continue
    }
    const level = tag.value === undefined || tag.value === null ? 'restricted' : parse(tag.value) ?? 'restricted'
    if (effective === undefined || rank(level) > rank(effective)) {
      effective = level
    }
  }
  return effective ?? defaultLevel
}
