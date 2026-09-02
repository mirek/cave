import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error the replay script is plain JavaScript
import { matches, wrapperScript } from '../../../scripts/book-examples.mjs'

// Every `$`-prompt session and every CAVE listing in the book is replayed
// against the real CLI by scripts/book-examples.mjs (see book/README.md for
// the conventions), except sessions marked `// no-test`, which need a model,
// a browser, a long-running server, or the optional Z3 solver package. A drifted output fails here; refresh
// the recorded output with `node scripts/book-examples.mjs --update`.
const script = fileURLToPath(new URL('../../../scripts/book-examples.mjs', import.meta.url))

test('recorded output matches line by line, with placeholders standing for real values', () => {
  assert.ok(matches('added 1 claim(s)\nok', 'added 1 claim(s)\nok\n'))
  assert.ok(!matches('foo\nbar', 'foobar'), 'line breaks are significant')
  assert.ok(matches('created <path> at <time>', 'created ./k.db at 2026-09-02T07:00:00Z'))
  assert.ok(matches('restored <path> from k.db', 'restored /tmp/my scratch/roastery.db from k.db'), '<path> may contain spaces')
  assert.ok(!matches('created <path>', 'created '), '<path> is not empty')
  assert.ok(!matches('name: <token> x', 'name: a b x'), '<token> has no spaces')
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

test('the cave wrapper survives shell metacharacters in the node and checkout paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-book-wrapper-'))
  try {
    // No backslash: Node's module loader rejects one in an entry path.
    const odd = join(dir, "it's $HOME `x` dir")
    mkdirSync(odd)
    const entry = join(odd, 'main.mjs')
    writeFileSync(entry, 'console.log(`ok ${process.argv.slice(2).join(",")}`)\n')
    const wrapper = join(dir, 'cave')
    writeFileSync(wrapper, wrapperScript(process.execPath, entry))
    chmodSync(wrapper, 0o755)
    const result = spawnSync('sh', ['-c', `"$0" a 'b c'`, wrapper], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'ok a,b c\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the book\'s runnable examples match the shipped CLI', { skip: process.platform === 'win32' && 'book sessions are POSIX sh' }, () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 600_000 })
  assert.equal(result.status, 0, `book examples drifted:\n${result.stdout}${result.stderr}`)
})
