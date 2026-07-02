/**
 * Entity names (spec §4.1).
 *
 * Entities are compact names: `auth/middleware`, `react/hooks/use-memo`,
 * `PostgreSQL`, `Sarah`. `/` separates scope segments (at most 3:
 * `domain/entity/aspect`), segments are kebab-case, proper nouns keep their
 * casing.
 */

export type Entity = string

export type t = Entity

/**
 * Normalizes an entity name (spec §13.4 step 4): trims and collapses runs of
 * internal whitespace to `-`. Casing is preserved — proper nouns keep theirs.
 *
 * `token expiry` → `token-expiry`, `PostgreSQL` → `PostgreSQL`.
 */
export const normalize = (name: string): Entity =>
  name.trim().replace(/\s+/g, '-')

/** @returns scope segments of an entity name: `a/b/c` → `['a', 'b', 'c']`. */
export const segments = (entity: Entity): string[] =>
  entity.split('/')

/**
 * Advisory well-formedness check (spec §4.1). Returns a list of human-readable
 * problems; an empty list means the name follows every convention. Problems
 * are advisories, not parse errors — CAVE tolerates messy extraction input.
 */
export const check = (entity: Entity): string[] => {
  const problems: string[] = []
  if (entity.length === 0) {
    problems.push('empty entity name')
    return problems
  }
  const parts = segments(entity)
  if (parts.length > 3) {
    problems.push(`more than 3 scope segments (${parts.length}): domain/entity/aspect is the maximum`)
  }
  if (parts.some(part => part.length === 0)) {
    problems.push('empty scope segment')
  }
  if (/\s/.test(entity)) {
    problems.push('whitespace in entity name (normalize to -)')
  }
  return problems
}
