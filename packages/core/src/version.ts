/**
 * The package version, read at call time from the nearest package.json
 * above this module (`src/` in development, `dist/src/` when published).
 * All `@cavelang/*` packages version in lockstep, so this is also the
 * version of any package importing it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const current = (): string => {
  for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      return (JSON.parse(readFileSync(candidate, 'utf8')) as { version: string }).version
    }
    if (dir === dirname(dir)) {
      return 'unknown'
    }
  }
}
