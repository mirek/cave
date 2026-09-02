import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// @ts-expect-error the replay script is plain JavaScript
import { matches } from '../../../scripts/book-examples.mjs'

// Every `$`-prompt session and every CAVE listing in the book is replayed
// against the real CLI by scripts/book-examples.mjs (see book/README.md for
// the conventions), except sessions marked `// no-test`, which need a model,
// a browser, or a long-running server. A drifted output fails here; refresh
// the recorded output with `node scripts/book-examples.mjs --update`.
const script = fileURLToPath(new URL('../../../scripts/book-examples.mjs', import.meta.url))

test('recorded output matches line by line, with placeholders standing for real values', () => {
  assert.ok(matches('added 1 claim(s)\nok', 'added 1 claim(s)\nok\n'))
  assert.ok(!matches('foo\nbar', 'foobar'), 'line breaks are significant')
  assert.ok(matches('created <path> at <time>', 'created ./k.db at 2026-09-02T07:00:00Z'))
  assert.ok(matches('a\n…\nz', 'a\nb\nc\nz'))
  assert.ok(matches('rest: <any>', 'rest: anything at all, with spaces'))
  assert.ok(matches('rest: <any>', 'rest: '), '<any> may be empty')
  for (const placeholder of ['<path>', '<token>', '<any>']) {
    assert.ok(!matches(`value ${placeholder}`, `value ${placeholder}`), `${placeholder} rejects its own spelling`)
    assert.ok(!matches(`value ${placeholder}`, `value x${placeholder}`), `${placeholder} rejects an embedded literal`)
  }
  assert.ok(!matches('<n>', '<n>'))
  assert.ok(!matches('a\n…\nz', 'a\ncave doctor <any>\nz'), 'a … line does not hide a literal placeholder')
})

test('the book\'s runnable examples match the shipped CLI', { skip: process.platform === 'win32' && 'book sessions are POSIX sh' }, () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 600_000 })
  assert.equal(result.status, 0, `book examples drifted:\n${result.stdout}${result.stderr}`)
})
