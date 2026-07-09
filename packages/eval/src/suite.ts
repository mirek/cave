/**
 * Suite discovery — eval fixtures as plain files (roadmap item 9).
 *
 * A suite is any directory; a *case* is named by its golden file:
 *
 * ```
 * suite/
 *   instructions.md               (optional, shared by the suite)
 *   family-history.md             the source the agent extracts from
 *   family-history.golden.cave    the expected extraction
 *   family-history.queries.cave   (optional) CAVE-Q behavioral checks
 * ```
 *
 * For `<stem>.golden.cave` the source is the single sibling `<stem>.<ext>`
 * whose extension has no further dots — so goldens, queries and
 * instructions of this or other cases never masquerade as sources, while
 * `design.notes.md` still pairs with `design.notes.golden.cave`. Zero or
 * several candidates is a fixture problem, reported instead of guessed.
 *
 * Instructions resolve nearest-first: an explicit path (CLI `--instructions`)
 * beats `<stem>.instructions.md` beats the case directory's
 * `instructions.md` beats the suite root's.
 */

import { existsSync, globSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'

export const goldenSuffix = '.golden.cave'
export const queriesSuffix = '.queries.cave'
export const instructionsSuffix = '.instructions.md'

/** Suite-shared instructions file name. */
export const sharedInstructions = 'instructions.md'

export type Case = {
  /** Display name — the golden's path relative to `cwd`, suffix dropped. */
  readonly name: string
  /** Absolute source file the agent extracts from. */
  readonly source: string
  /** Absolute golden `.cave` path. */
  readonly golden: string
  /** Absolute queries file path, when the case has one. */
  readonly queries?: string
  /** Absolute instructions markdown path, when one resolves. */
  readonly instructions?: string
}

export type Suite = {
  /** Discovered cases, sorted by name. */
  readonly cases: readonly Case[]
  /** Fixture problems — goldens that could not become cases. */
  readonly problems: readonly string[]
}

/** @returns source candidates: `<stem>.<ext>` siblings with a dot-free extension. */
const sourcesOf = (golden: string): string[] => {
  const dir = dirname(golden)
  const stem = basename(golden).slice(0, -goldenSuffix.length)
  return readdirSync(dir)
    .filter(name => {
      if (!name.startsWith(`${stem}.`)) {
        return false
      }
      const extension = name.slice(stem.length + 1)
      return extension !== '' && !extension.includes('.') && statSync(join(dir, name)).isFile()
    })
    .sort()
    .map(name => join(dir, name))
}

const instructionsOf = (golden: string, root: string, explicit: undefined | string): undefined | string => {
  const candidates = [
    explicit,
    `${golden.slice(0, -goldenSuffix.length)}${instructionsSuffix}`,
    join(dirname(golden), sharedInstructions),
    join(root, sharedInstructions)
  ]
  return candidates.find(path => path !== undefined && existsSync(path))
}

const caseOf = (
  golden: string,
  root: string,
  cwd: string,
  explicit: undefined | string
): { kase: Case } | { problem: string } => {
  const sources = sourcesOf(golden)
  const name = relative(cwd, golden).slice(0, -goldenSuffix.length)
  if (sources.length === 0) {
    return { problem: `${name}: no source file — expected a single ${basename(golden).slice(0, -goldenSuffix.length)}.<ext> beside ${basename(golden)}` }
  }
  if (sources.length > 1) {
    return { problem: `${name}: ambiguous source — ${sources.map(source => basename(source)).join(', ')}` }
  }
  const queries = `${golden.slice(0, -goldenSuffix.length)}${queriesSuffix}`
  const instructions = instructionsOf(golden, root, explicit)
  return {
    kase: {
      name,
      source: sources[0]!,
      golden,
      ...existsSync(queries) ? { queries } : {},
      ...instructions === undefined ? {} : { instructions }
    }
  }
}

/**
 * Discovers the cases of one or more suites. Each root may be a directory
 * (searched recursively for `*.golden.cave`) or a single golden file.
 */
export const discover = (
  roots: readonly string[],
  options: { instructions?: string, cwd?: string } = {}
): Suite => {
  const cwd = options.cwd ?? process.cwd()
  const explicit = options.instructions === undefined ? undefined : resolve(cwd, options.instructions)
  const cases: Case[] = []
  const problems: string[] = []
  for (const root of roots) {
    const absolute = resolve(cwd, root)
    if (!existsSync(absolute)) {
      problems.push(`${root}: no such file or directory`)
      continue
    }
    if (statSync(absolute).isFile()) {
      if (!absolute.endsWith(goldenSuffix)) {
        problems.push(`${root}: not a suite directory or ${goldenSuffix} file`)
        continue
      }
      const outcome = caseOf(absolute, dirname(absolute), cwd, explicit)
      if ('kase' in outcome) {
        cases.push(outcome.kase)
      } else {
        problems.push(outcome.problem)
      }
      continue
    }
    const goldens = globSync(`**/*${goldenSuffix}`, { cwd: absolute }).sort()
    if (goldens.length === 0) {
      problems.push(`${root}: no ${goldenSuffix} cases found`)
      continue
    }
    for (const golden of goldens) {
      const outcome = caseOf(join(absolute, golden), absolute, cwd, explicit)
      if ('kase' in outcome) {
        cases.push(outcome.kase)
      } else {
        problems.push(outcome.problem)
      }
    }
  }
  return { cases: cases.sort((a, b) => a.name.localeCompare(b.name)), problems }
}
