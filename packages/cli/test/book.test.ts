import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Every `$`-prompt session and every CAVE listing in the book is replayed
// against the real CLI by scripts/book-examples.mjs (see book/README.md for
// the conventions). A drifted output fails here; refresh the recorded
// output with `node scripts/book-examples.mjs --update`.
const script = fileURLToPath(new URL('../../../scripts/book-examples.mjs', import.meta.url))

test('the book\'s runnable examples match the shipped CLI', { skip: process.platform === 'win32' && 'book sessions are POSIX sh' }, () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 600_000 })
  assert.equal(result.status, 0, `book examples drifted:\n${result.stdout}${result.stderr}`)
})
