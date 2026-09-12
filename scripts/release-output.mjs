#!/usr/bin/env node
/** Report already-verified publications to Changesets action v2; never publish or tag. */
import { appendFileSync } from 'node:fs'

const output = process.env.CHANGESETS_OUTPUT
if (output) {
  const [version, ...packageNames] = process.argv.slice(2)
  if (!version) throw new Error('release-output: a verified release version is required')
  const events = packageNames.map(packageName => JSON.stringify({
    type: 'git-tag', tag: `v${version}`, packageName,
  }) + '\n').join('')
  // An empty recovery creates an empty file, rather than a missing-output warning.
  // Append preserves events from any earlier publisher sharing this output path.
  appendFileSync(output, events, 'utf8')
}
