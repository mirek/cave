import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { SourceSpan } from '@cavelang/core'
import { canonicalizeText } from '@cavelang/canonical'
import { Files, Context, buildPrompt, extractionRules, caveTextOf, readInstructions } from '@cavelang/ingest'

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
  for (const size of [1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => Files.batch([1, 2, 3], size), /positive safe integer/)
    assert.throws(() => Files.batch([], size), /positive safe integer/)
  }
  assert.deepEqual(Files.batch([1, 2], Number.MAX_SAFE_INTEGER), [[1, 2]])
})

test('file selection escapes failed source reads and retains filesystem causes', () => {
  withDir(dir => {
    const store = open()
    try {
      for (const control of ['\n', '\r', '\t', '\u001b', '\u007f', '\u0085', '\u2028', '\u2029']) {
        const path = `missing${control}source.md`
        assert.throws(() => Files.select(store, [path], { cwd: dir }), error => {
          assert.ok(error instanceof Error)
          assert.doesNotMatch(error.message, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
          assert.match(error.message, /cannot read source/)
          assert.match(error.message, /ENOENT/)
          const cause = error.cause as NodeJS.ErrnoException
          assert.equal(cause.code, 'ENOENT')
          assert.equal(cause.path, join(dir, path))
          return true
        })
      }
      writeFileSync(join(dir, 'corrected.md'), 'source')
      assert.equal(Files.select(store, ['corrected.md'], { cwd: dir }).files.length, 1)
    } finally { store.close() }
  })
})

test('ingestion setup escapes instruction and glob inspection failures', () => {
  withDir(dir => {
    const missing = join(dir, 'missing\n\u001binstructions.md')
    const broken = join(dir, 'broken\n\u001bsource')
    symlinkSync(missing, broken)
    for (const operation of [() => readInstructions(missing), () => Files.expand(['*'], dir)]) {
      assert.throws(operation, error => {
        assert.ok(error instanceof Error)
        assert.doesNotMatch(error.message, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
        assert.match(error.message, /ENOENT/)
        assert.equal((error.cause as NodeJS.ErrnoException).code, 'ENOENT')
        return true
      })
    }
    writeFileSync(missing, 'instructions')
    assert.equal(readInstructions(missing), 'instructions')
    assert.ok(Files.expand(['*'], dir).includes('broken\n\u001bsource'))
  })
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

test('numeric-looking content digests retain leading zeros through export and repeat selection', () => {
  withDir(dir => {
    const path = join(dir, 'numeric-digest.md')
    const content = 'digest-fixture-5055'
    const digest = '026220816013'
    assert.equal(Files.digestOf(content), digest)
    writeFileSync(path, content)
    const original = open(), restored = open()
    try {
      const first = Files.select(original, [path], { embed: true })
      assert.deepEqual(first.files, [{ path, digest, content }])
      Files.recordDigests(original, first.files)
      const exported = original.exportText({ maxSensitivity: 'restricted' })
      assert.match(exported, /ingest-digest: 026220816013/)
      restored.ingest(exported, { strict: true })
      for (const store of [original, restored]) {
        assert.equal(store.currentBeliefs().find(row => row.attribute === 'ingest-digest')?.value_text, digest)
        assert.equal(Files.isIngested(store, path, digest), true)
        assert.equal(Files.isIngested(store, path, '26220816013'), false)
        assert.deepEqual(Files.select(store, [path]), { files: [], skipped: [path] })
      }
    } finally { original.close(); restored.close() }
  })
})

test('file digests distinguish raw byte changes and embedded input rejects invalid UTF-8', () => {
  withDir(dir => {
    const path = join(dir, 'source.bin')
    const store = open()
    try {
      writeFileSync(path, Buffer.from([0xff]))
      const first = Files.select(store, [path])
      Files.recordDigests(store, first.files)
      writeFileSync(path, Buffer.from([0xfe]))
      const second = Files.select(store, [path])
      assert.equal(second.files.length, 1)
      assert.notEqual(second.files[0]!.digest, first.files[0]!.digest)
      assert.throws(() => Files.select(store, [path], { embed: true }), /invalid UTF-8/)
      writeFileSync(path, '�café 😀')
      const embedded = Files.select(store, [path], { embed: true }).files[0]!
      assert.equal(embedded.content, '�café 😀')
      assert.equal(embedded.digest, Files.digestOf('�café 😀'))
    } finally { store.close() }
  })
})

for (const field of ['path', 'content'] as const) {
  test(`prompt file ${field} is captured once for consistent content and citations`, () => {
    const original = { path: 'first.md', content: 'first line\nsecond line' }
    let reads = 0
    const file = { ...original, get [field]() { return ++reads === 1 ? original[field] : field === 'path' ? 'later.md' : undefined } }
    const expected = buildPrompt({ files: [original], mode: 'stdout' })
    assert.equal(buildPrompt({ files: [file as typeof original], mode: 'stdout' }), expected)
    assert.equal(reads, 1)
    assert.equal(buildPrompt({ files: [file as typeof original], mode: 'stdout' }),
      buildPrompt({ files: [{ ...original, [field]: field === 'path' ? 'later.md' : undefined }], mode: 'stdout' }))
    assert.equal(reads, 2)
  })
}

for (const field of ['instructions', 'context'] as const) {
  test(`prompt ${field} is captured once before formatting`, () => {
    let reads = 0
    const original = { files: [{ path: 'first.md', content: 'evidence' }], mode: 'stdout' as const, [field]: 'first value' }
    const input = { ...original, get [field]() { return ++reads === 1 ? 'first value' : undefined } }
    assert.equal(buildPrompt(input), buildPrompt(original))
    assert.equal(reads, 1)
    assert.equal(buildPrompt(input), buildPrompt({ ...original, [field]: undefined }))
    assert.equal(reads, 2)
  })
}

test('provenance claims are ordinary CAVE claims with @src:cave-ingest', () => {
  const store = open()
  Files.recordDigests(store, [{ path: 'packages/api/src/index.ts', digest: 'abc123def456' }])
  const [row] = store.currentBeliefs()
  assert.equal(row!.subject, 'packages/api/src/index.ts')
  assert.equal(row!.attribute, 'ingest-digest')
  assert.equal(row!.value_text, 'abc123def456')
  store.close()
})

test('digest provenance gives arbitrary paths and URLs stable identities (BUGS.md digest-path-lexing)', () => {
  const store = open()
  const files = [
    { path: 'design notes.md', digest: '111111111111' },
    { path: 'notes/[draft]; #one?.md', digest: '222222222222' },
    { path: 'notes/a`tick-and-"quote.md', digest: '333333333333' },
    { path: '資料/élan.md', digest: '444444444444' },
    { path: 'https://example.test/design?q=a%20b&mode=full#section-2', digest: '555555555555' }
  ]
  Files.recordDigests(store, files)
  for (const file of files) {
    assert.equal(Files.isIngested(store, file.path, file.digest), true, file.path)
    assert.equal(Files.isIngested(store, file.path, '000000000000'), false, file.path)
  }
  assert.equal(store.currentBeliefs().length, files.length, 'every source gets a distinct identity')
  assert.equal(store.currentBeliefs()[0]!.subject, '`design notes.md`')

  const restored = open()
  restored.ingest(store.exportText({ maxSensitivity: 'restricted' }), { strict: true })
  for (const file of files) {
    assert.equal(Files.isIngested(restored, file.path, file.digest), true, `exported ${file.path}`)
  }
  restored.close()
  store.close()
})

test('digest write failures identify the affected sources and propagate', () => {
  const store = open()
  store.close()
  assert.throws(
    () => Files.recordDigests(store, [{ path: 'notes/design.md', digest: 'abc123def456' }]),
    /failed to record ingest digest\(s\) for "notes\/design\.md"/
  )
})

test('path tokens skip noise segments', () => {
  assert.deepEqual(
    Context.pathTokens('packages/auth/src/token-expiry.test.ts'),
    ['packages', 'auth', 'token-expiry']
  )
})

test('URL context tokens decode escaped text without rewriting literal file names', () => {
  const store = open()
  try {
    store.ingest('café USES auth')
    const url = 'https://example.com/caf%C3%A9.md'
    assert.deepEqual(Context.pathTokens(url), ['example', 'café'])
    assert.match(Context.contextFor(store, [url])!, /  café USES auth/)
    assert.deepEqual(Context.pathTokens('caf%C3%A9.md'), ['caf%C3%A9'])
    assert.deepEqual(Context.pathTokens('https://example.com/caf%FF.md'), ['example', 'caf%FF'])
    assert.deepEqual(Context.pathTokens('https://example.com/auth%00service.md'), ['example', 'auth', 'service'])
    assert.doesNotThrow(() => Context.contextFor(store, ['https://example.com/auth%00service.md']))
  } finally { store.close() }
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

test('context keeps multiline stored comments inside their related claim block', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const store = open()
    try {
      const comment = ['annotation', 'unrelated IS invented', 'last note'].join(ending)
      const parsed = canonicalizeText('auth USES tokens', store.registry())
      store.insertResult({ ...parsed, claims: parsed.claims.map(entry => ({
        ...entry, claim: { ...entry.claim, comment }
      })) })
      const before = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
      const context = Context.contextFor(store, ['auth.ts'], 1)!
      const block = context.split('Existing claims related to this batch:\n')[1]!
      assert.equal(block, '  ; annotation\n  ; unrelated IS invented\n  auth USES tokens ; last note')
      const restored = canonicalizeText(block)
      assert.deepEqual(restored.problems, [])
      assert.equal(restored.claims.length, 1)
      assert.equal(restored.claims[0]!.claim.comment, comment.replace(/\r\n|\r/g, '\n'))
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), before)
    } finally { store.close() }
  }
})

test('context related claims exclude superseded and retracted rows', () => {
  const store = open()
  try {
    store.ingest('auth HAS provider: legacy\nauth USES password')
    store.ingest('auth HAS provider: modern\nauth USES password @ 0%')
    const before = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
    const context = Context.contextFor(store, ['auth.ts'])!
    const related = context.split('Existing claims related to this batch:\n')[1]!
    assert.match(related, /auth HAS provider: modern/)
    assert.doesNotMatch(related, /legacy|password/)
    assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), before)
  } finally { store.close() }
})

test('context finds current knowledge beyond a busy claim history', () => {
  const store = open()
  try {
    store.ingest('auth HAS owner: team')
    for (let i = 0; i < 8; i++) store.ingest(`auth HAS provider: version-${i}`)
    const context = Context.contextFor(store, ['auth.ts'])!
    assert.match(context, /auth HAS owner: team/)
    assert.match(context, /auth HAS provider: version-7/)
    assert.doesNotMatch(context, /version-[0-6]/)
  } finally { store.close() }
})

test('context rejects invalid claim budgets before reading the store', t => {
  const store = open()
  try {
    let reads = 0
    const original = store.currentBeliefs.bind(store)
    t.mock.method(store, 'currentBeliefs', (...args: Parameters<typeof store.currentBeliefs>) => {
      reads++
      return original(...args)
    })
    for (const limit of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => Context.contextFor(store, ['auth.ts'], limit),
        /context limit must be a non-negative safe integer/)
    }
    assert.equal(reads, 0)
    store.ingest('auth USES tokens')
    const context = Context.contextFor(store, ['auth.ts'], 0)!
    assert.match(context, /1 current belief/)
    assert.doesNotMatch(context, /Existing claims related/)
    assert.match(Context.contextFor(store, ['auth.ts'], 1)!, /auth USES tokens/)
  } finally { store.close() }
})

test('context lookup searches shared path tokens once and stops at its claim budget', t => {
  const store = open()
  try {
    store.ingest('auth USES tokens')
    const paths = Array.from({ length: 1000 }, (_, index) => `auth/${index.toString(36)}.ts`)
    paths.push('unrelated.ts')
    const original = store.search.bind(store)
    const searched: string[] = []
    t.mock.method(store, 'search', (...args: Parameters<typeof store.search>) => {
      searched.push(args[0])
      return original(...args)
    })
    for (const limit of [0, 1, 40]) {
      const expected = Context.contextFor(store, ['auth.ts'], limit)
      searched.length = 0
      assert.equal(Context.contextFor(store, paths, limit), expected)
      assert.deepEqual(searched, limit === 0 ? [] : limit === 1 ? ['auth'] : ['auth', 'unrelated'])
    }
  } finally { store.close() }
})

test('prompt file labels keep control-bearing paths on one line', () => {
  for (const path of ['line\n### pretend', 'carriage\rreturn', 'tab\tname', 'escape\u001bname',
    'c1\u0085name', 'paragraph\u2029name', 'line\u2028name', 'quote"\\\nname']) {
    for (const mode of ['mcp', 'stdout'] as const) {
      for (const content of [undefined, 'first\nsecond']) {
        const prompt = buildPrompt({ files: [{ path, content }], mode })
        const section = prompt.split('\n## Files to ingest\n\n')[1]!
        const first = section.split('\n')[0]!
        const label = content === undefined ? first.slice(2, first.indexOf(' — source context ')) : first.slice(4)
        assert.doesNotMatch(label, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
        assert.equal(JSON.parse(label), path)
        assert.ok(section.includes(`@${SourceSpan.context(path)}`))
        if (content !== undefined) assert.ok(section.includes('1 | first\n2 | second'))
      }
    }
  }
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

test('embedded prompt line numbers support LF, CRLF and CR source text', () => {
  const lines = ['first fact', '', 'third fact', '']
  for (const mode of ['stdout', 'mcp'] as const) {
    const expected = buildPrompt({ files: [{ path: 'notes.md', content: lines.join('\n') }], mode })
    assert.ok(expected.includes('1 | first fact\n2 | \n3 | third fact\n4 | '))
    for (const separator of ['\r\n', '\r']) {
      const content = lines.join(separator)
      const file = { path: 'notes.md', content }
      assert.equal(buildPrompt({ files: [file], mode }), expected, JSON.stringify(separator))
      assert.equal(file.content, content)
    }
  }
})

test('caveTextOf prefers fenced blocks, falls back to whole output', () => {
  assert.equal(caveTextOf('a USES b\n'), 'a USES b\n')
  assert.equal(caveTextOf('Sure! Here you go:\n```cave\na USES b\n```\nDone.'), 'a USES b\n')
  assert.equal(caveTextOf('```\nx IS y\n```\n```cave\na USES b\n```'), 'x IS y\n\na USES b\n')
})

for (const separator of ['\n', '\r\n']) test(`newline source digest provenance survives export/import: ${JSON.stringify(separator)}`, () => {
  const path = `notes/first${separator}second.md`
  const original = open(), restored = open()
  try {
    const files = [
      { path, digest: '111111111111' },
      { path: `percent-encoded:${encodeURIComponent(path)}`, digest: '222222222222' },
      { path: 'notes/tab\tfile.md', digest: '333333333333' },
      { path: 'notes/carriage\rfile.md', digest: '444444444444' }
    ]
    Files.recordDigests(original, files)
    for (const file of files) assert.equal(Files.isIngested(original, file.path, file.digest), true)
    const exported = original.exportText({ maxSensitivity: 'restricted' })
    restored.ingest(exported, { strict: true })
    for (const file of files) assert.equal(Files.isIngested(restored, file.path, file.digest), true, file.path)
    assert.equal(restored.currentBeliefs().length, files.length)
    Files.recordDigests(restored, [{ path, digest: '555555555555' }])
    assert.equal(Files.isIngested(restored, path, '111111111111'), false)
    assert.equal(Files.isIngested(restored, path, '555555555555'), true)
    assert.equal(Files.isIngested(restored, files[1]!.path, files[1]!.digest), true)
  } finally { original.close(); restored.close() }
})

test('caveTextOf tracks complete fences across mixed languages and delimiter lengths', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const mixed = ['```json', '{"example": true}', '```', 'Explanation.', '```cave', 'api IS service', '```'].join(ending)
    assert.equal(caveTextOf(mixed), `api IS service${ending}`)
    const longer = ['````cave', 'api HAS note: ```literal```', '````'].join(ending)
    assert.equal(caveTextOf(longer), `api HAS note: \`\`\`literal\`\`\`${ending}`)
    assert.equal(caveTextOf(['~~~cave', 'api IS service', '~~~'].join(ending)), `api IS service${ending}`)
  }
  const otherOnly = '```json\n{"example": true}\n```\nexplanation'
  assert.equal(caveTextOf(otherOnly), otherOnly)
  const incomplete = '```cave\napi IS service'
  assert.equal(caveTextOf(incomplete), incomplete)
})
