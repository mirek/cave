import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error the replay script is plain JavaScript
import { checkChapter, matches, wrapperScript } from '../../../scripts/book-examples.mjs'

// Every `$`-prompt session and every CAVE listing in the book is replayed
// against the real CLI by scripts/book-examples.mjs (see book/README.md for
// the conventions), except sessions marked `// no-test`, which need a model,
// a browser, a long-running server, or the optional Z3 solver package. A drifted output fails here; refresh
// the recorded output with `node scripts/book-examples.mjs --update`.
const script = fileURLToPath(new URL('../../../scripts/book-examples.mjs', import.meta.url))

test('book setup failures clean temporary workspaces and allow retry', { skip: process.platform === 'win32' && 'book sessions are POSIX sh' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-book-setup-test-'))
  const scratch = join(dir, 'tmp')
  const preload = join(dir, 'fail-setup.mjs')
  mkdirSync(scratch)
  try {
    for (const operation of ['chmodSync', 'cpSync']) {
      // Patch only the child process. Fail after files exist to exercise cleanup
      // of a partially prepared wrapper or chapter, not just an empty directory.
      writeFileSync(preload, `import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const original = fs.${operation}
fs.${operation} = (...args) => {
  original(...args)
  throw new Error('injected ${operation} setup failure')
}
syncBuiltinESMExports()
`)
      const result = spawnSync(process.execPath, ['--import', preload, script, '--only', '28-operating'], {
        encoding: 'utf8', timeout: 10_000, env: { ...process.env, TMPDIR: scratch }
      })
      assert.equal(result.error, undefined)
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, new RegExp(`injected ${operation} setup failure`))
      assert.deepEqual(readdirSync(scratch), [], `${operation} left temporary workspaces`)
    }
    const retry = spawnSync(process.execPath, [script, '--only', '28-operating'], {
      encoding: 'utf8', timeout: 30_000, env: { ...process.env, TMPDIR: scratch }
    })
    assert.equal(retry.error, undefined)
    assert.equal(retry.status, 0, retry.stdout + retry.stderr)
    assert.match(retry.stdout, /28-operating.*: ok/)
    assert.deepEqual(readdirSync(scratch), [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('book chapter filters reject missing or unmatched selections', () => {
  for (const args of [
    ['--only', 'no-such-chapter'], ['--only', '28-operating,24-sync'],
    ['--only', ''], ['--only'], ['--only', '--update'], ['--unknown'],
    ['17'], ['--only', '17', '--only', '18'], ['--update', '--only', 'no-such-chapter']
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 5000 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 2, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }))
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /--only|Unknown|argument/)
  }
})

test('book refresh preserves surrounding text across large output replacement', { skip: process.platform === 'win32' && 'book sessions are POSIX sh' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-book-large-output-'))
  const file = join(dir, 'chapter.typ')
  const command = '$ awk \'BEGIN { for (i = 0; i < 130000; i++) print "x" }\''
  const prefix = ['Before.', '```sh', command].join('\n') + '\n'
  const suffix = ['```', 'After.', '```sh', '$ echo ready', 'old', '```', ''].join('\n')
  try {
    writeFileSync(file, prefix + 'old\n' + suffix)
    assert.deepEqual(checkChapter(file, dir, true), { problems: [], updated: true })
    assert.equal(readFileSync(file, 'utf8'), prefix + 'x\n'.repeat(130_000) + suffix.replace('\nold\n', '\nready\n'))
    assert.deepEqual(checkChapter(file, dir, false), { problems: [], updated: false })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('long recorded outputs retain placeholder and ellipsis matching', () => {
  const size = 130_000
  const expected = Array.from({ length: size }, () => '<n>').join('\n')
  const actual = Array.from({ length: size }, (_, i) => String(i)).join('\n')
  assert.equal(matches(expected, actual), true)
  assert.equal(matches(expected, actual + '\nextra'), false)
  assert.equal(matches('a\n…\nb\nc', 'a\nb\nb\nc'), true)
  assert.equal(matches('a\n…\nb\n...\nc', 'a\nx\nb\ny\nc'), true)
  assert.equal(matches('a\n…\nb\n...\nc', 'a\nx\nb\n<token>\nc'), false)
  assert.equal(matches('a\n…\nb\nc', 'a\nb\nx'), false)
})

test('the recorded doctor session accepts release versions without hiding diagnostic drift', () => {
  const chapter = readFileSync(new URL('../../../book/chapters/28-operating.typ', import.meta.url), 'utf8')
  const recorded = chapter.split('$ cave doctor --db roastery.db\n')[1]?.split('```')[0]?.trimEnd()
  assert.ok(recorded, 'the operating chapter includes the doctor session')
  for (const version of ['0.35.0', '0.36.0', '1.0.0']) {
    const actual = recorded.replace(/^cave doctor .*$/m, `cave doctor ${version}`)
      .replace('PASS Node <token>', 'PASS Node 24.21.0')
      .replace('PASS SQLite <token>', 'PASS SQLite 3.53.4')
    assert.ok(matches(recorded, actual), `the example must survive release ${version}`)
    assert.ok(!matches(recorded, actual.replace('result: ready', 'result: failed')))
  }
})

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

test('recorded output preserves blank lines and control characters around wildcards', () => {
  const cases: [string, string, boolean][] = [
    ['', '', true],
    ['', '\n\n', true],
    ['a\n\nb', 'a\nb', false],
    ['\na', '\na\n', true],
    ['a\n', 'a\n', false], // Only actual output has trailing newlines stripped.
    ['a\n…\nb', 'a\n\nb', true],
    ['…\n...', '', true],
    ['…\n<n>\n…', '\n12\n\r\n\u2028', true],
    ['…\na', '<token>\na', false],
    ['<any>', '\r\u2028', true],
    ['<path>', '\r\u2028', true],
    ['<token>', '\r\u2028', false],
    ['a\r', 'a', false],
    ['a\u2028', 'a\u2028', true],
  ]
  for (const [expected, actual, accepted] of cases) {
    assert.equal(matches(expected, actual), accepted, JSON.stringify({ expected, actual }))
  }
})

test('the cave wrapper survives shell metacharacters in the node and checkout paths', { skip: process.platform === 'win32' && 'the wrapper is a POSIX sh script' }, () => {
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
