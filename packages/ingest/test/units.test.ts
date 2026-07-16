import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { Files, Context, buildPrompt, extractionRules, caveTextOf } from '@cavelang/ingest'

const withDir = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-test-'))
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('glob expansion: dedupe, sort, ** patterns', () => {
  withDir(dir => {
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.ts'), 'a')
    writeFileSync(join(dir, 'src', 'deep', 'b.ts'), 'b')
    writeFileSync(join(dir, 'readme.md'), 'hello')
    const files = Files.expand(['src/**/*.ts', 'readme.md', '*.md'], dir)
    assert.deepEqual(files, ['readme.md', join('src', 'a.ts'), join('src', 'deep', 'b.ts')])
  })
})

test('batching splits evenly and validates size', () => {
  assert.deepEqual(Files.batch([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(Files.batch([], 3), [])
  assert.throws(() => Files.batch([1], 0))
})

test('digest selection skips unchanged files; force re-selects (incremental ingestion)', () => {
  withDir(dir => {
    const path = join(dir, 'a.md')
    writeFileSync(path, 'knowledge')
    const store = open()
    const first = Files.select(store, [path])
    assert.equal(first.files.length, 1)
    Files.recordDigests(store, first.files)
    const second = Files.select(store, [path])
    assert.deepEqual(second.files, [])
    assert.deepEqual(second.skipped, [path])
    writeFileSync(path, 'changed knowledge')
    const third = Files.select(store, [path])
    assert.equal(third.files.length, 1, 'content change re-selects')
    const forced = Files.select(store, [path], { force: true })
    assert.equal(forced.files.length, 1)
    store.close()
  })
})

test('provenance claims are ordinary CAVE claims with @src:cave-ingest', () => {
  const store = open()
  Files.recordDigests(store, [{ path: 'packages/api/src/index.ts', digest: 'abc123def456' }])
  const [row] = store.currentBeliefs()
  assert.equal(row!.subject, 'packages/api/src/index.ts')
  assert.equal(row!.attribute, 'ingest-digest')
  assert.equal(row!.value_text, 'abc123def456')
  store.close()
})

test('digest provenance supports paths that are not valid entity atoms (BUGS.md digest-path-lexing)', () => {
  const store = open()
  const file = { path: 'design notes.md', digest: 'abc123def456' }
  Files.recordDigests(store, [file])
  assert.equal(Files.isIngested(store, file.path, file.digest), true)
  assert.equal(store.currentBeliefs()[0]!.subject, '`design notes.md`')
  store.close()
})

test('path tokens skip noise segments', () => {
  assert.deepEqual(
    Context.pathTokens('packages/auth/src/token-expiry.test.ts'),
    ['packages', 'auth', 'token-expiry']
  )
})

test('context slice: stats, naming anchors, related claims; empty store → undefined', () => {
  const empty = open()
  assert.equal(Context.contextFor(empty, ['a.ts']), undefined)
  empty.close()
  const store = open()
  store.ingest([
    'auth/middleware USES jwt',
    'auth/middleware HAS bug: token-expiry #security',
    'billing USES stripe'
  ].join('\n'))
  const context = Context.contextFor(store, ['packages/auth/notes.md'])!
  assert.match(context, /3 current belief/)
  assert.match(context, /auth\/middleware \(2\)/)
  assert.match(context, /Existing claims related to this batch:/)
  assert.match(context, /auth\/middleware USES jwt/)
  store.close()
})

test('prompt carries card, rules, instructions, context, files and protocol', () => {
  const prompt = buildPrompt({
    files: [{ path: 'a.ts' }, { path: 'b.md' }],
    instructions: 'Focus on architecture decisions.',
    context: 'The database currently holds 3 current belief(s).',
    mode: 'mcp'
  })
  assert.match(prompt, /subject VERB/)
  assert.ok(prompt.includes(extractionRules))
  assert.match(prompt, /Focus on architecture decisions\./)
  assert.match(prompt, /3 current belief/)
  assert.match(prompt, /- a\.ts — source context @src:a\.ts/)
  assert.match(prompt, /- b\.md — source context @src:b\.md/)
  assert.match(prompt, /cave_add/)
  const stdout = buildPrompt({ files: [{ path: 'a.ts', content: 'const x = 1' }], mode: 'stdout' })
  assert.match(stdout, /### a\.ts\nSource context: @src:a\.ts\n```text\n1 \| const x = 1\n```/)
  assert.match(stdout, /print ONLY CAVE text/)
  assert.doesNotMatch(stdout, /cave_add/)
})

test('caveTextOf prefers fenced blocks, falls back to whole output', () => {
  assert.equal(caveTextOf('a USES b\n'), 'a USES b\n')
  assert.equal(caveTextOf('Sure! Here you go:\n```cave\na USES b\n```\nDone.'), 'a USES b\n')
  assert.equal(caveTextOf('```\nx IS y\n```\n```cave\na USES b\n```'), 'x IS y\n\na USES b\n')
})
