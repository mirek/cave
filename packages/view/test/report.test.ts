import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceSpan, Uuidv7 } from '@cavelang/core'
import { canonicalizeText } from '@cavelang/canonical'
import { open } from '@cavelang/store'
import { report } from '@cavelang/view'

test('reports reject malformed or mismatched citation transactions before emitting dates', () => {
  const store = open()
  try {
    store.ingest('api IS service #sensitivity:public')
    const row = store.currentBeliefs()[0]!
    const template = 'Status: `cave-q: api IS ?kind`'
    const original = report(store, template)
    for (const tx of [Uuidv7.at(0, 0, new Uint8Array(8)), row.tx.toUpperCase(), row.tx + 'junk']) {
      store.db.prepare('UPDATE cave_claim SET tx = ? WHERE id = ?').run(tx, row.id)
      const before = store.db.prepare('SELECT * FROM cave_claim').all()
      for (const maxSensitivity of ['public', 'internal', 'restricted'] as const) {
        assert.throws(() => report(store, template, { maxSensitivity }), error => {
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes(row.id), error.message)
          assert.match(error.message, /stored transaction identity/)
          return true
        })
        assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim').all(), before)
      }
    }
    store.db.prepare('UPDATE cave_claim SET tx = ? WHERE id = ?').run(row.tx, row.id)
    for (const maxSensitivity of ['public', 'internal', 'restricted'] as const) {
      assert.deepEqual(report(store, template, { maxSensitivity }), original)
    }
  } finally { store.close() }
})

test('reports reject corrupted citation keys at every included sensitivity and recover after repair', () => {
  const store = open()
  try {
    store.ingest('api IS service #sensitivity:public')
    const row = store.currentBeliefs()[0]!
    const template = 'Status: `cave-q: api IS ?kind`'
    const scopes = ['public', 'internal', 'restricted'] as const
    const originals = scopes.map(maxSensitivity => report(store, template, { maxSensitivity }))
    store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run('wrong-key', row.id)
    const before = store.db.prepare('SELECT * FROM cave_claim').all()
    for (const maxSensitivity of scopes) {
      assert.throws(() => report(store, template, { maxSensitivity }), error => {
        assert.ok(error instanceof Error)
        assert.ok(error.message.includes(row.id), error.message)
        assert.match(error.message, /stored claim key/)
        return true
      })
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim').all(), before)
    }
    store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(row.claim_key, row.id)
    for (const [index, maxSensitivity] of scopes.entries()) {
      assert.deepEqual(report(store, template, { maxSensitivity }), originals[index])
    }
    store.ingest('hidden IS service #sensitivity:restricted')
    const hidden = store.currentBeliefs().find(row => row.subject === 'hidden')!
    store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run('hidden-wrong-key', hidden.id)
    assert.deepEqual(report(store, template, { maxSensitivity: 'public' }), originals[0])
  } finally { store.close() }
})

test('large reports retain every citation without an argument-count limit', { timeout: 120_000 }, () => {
  const store = open()
  const count = 130_000
  try {
    store.ingest(Array.from({ length: count }, (_, i) => `record-${i} IS entry`).join('\n'))
    const result = report(store, '```cave-q\n?record IS entry\n```', { maxSensitivity: 'restricted' })
    assert.deepEqual(result.problems, [])
    assert.equal(result.citations, count)
    const lines = result.markdown.trimEnd().split('\n')
    assert.equal(lines.length, count * 2 + 1)
    assert.equal(lines[count], '')
    for (let i = 0; i < count; i++) {
      const number = i + 1
      const binding = /^- \?record = (record-\d+) \[\^c(\d+)\]$/.exec(lines[i]!)
      assert.ok(binding)
      assert.equal(binding[2], String(number))
      assert.ok(lines[count + 1 + i]!.startsWith(`[^c${number}]: \`${binding[1]} IS entry\``))
    }
    assert.equal(store.currentBeliefs().length, count)
  } finally { store.close() }
})

test('report citation failures identify the malformed stored claim and permit corrected retry', () => {
  const store = open()
  try {
    const inserted = store.ingest('api IS service')
    const id = inserted.ids[0]!
    store.db.prepare('INSERT INTO cave_context (claim_id, context) VALUES (?, ?)').run(id, 'broken\ncontext')
    const before = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
    const contexts = store.db.prepare('SELECT * FROM cave_context').all()
    for (const template of ['Status: `cave-q: api IS ?kind`', '```cave-q\napi IS ?kind\n```']) {
      assert.throws(() => report(store, template, { maxSensitivity: 'restricted' }), error => {
        assert.ok(error instanceof Error)
        assert.ok(error.message.includes(`report citation failed for claim ${id}`), error.message)
        assert.ok(error.cause instanceof Error)
        assert.ok(error.message.includes(error.cause.message))
        return true
      })
    }
    assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), before)
    assert.deepEqual(store.db.prepare('SELECT * FROM cave_context').all(), contexts)
    store.db.prepare('DELETE FROM cave_context WHERE claim_id = ? AND context = ?').run(id, 'broken\ncontext')
    const recovered = report(store, 'Status: `cave-q: api IS ?kind`', { maxSensitivity: 'restricted' })
    assert.deepEqual(recovered.problems, [])
    assert.equal(recovered.citations, 1)
    assert.match(recovered.markdown, /service\[\^c1\]/)
  } finally { store.close() }
})

test('report query diagnostics retain template lines for unprintable failures', t => {
  const store = open()
  const template = 'Status: `cave-q: api HAS status: ?v`\n\n```cave-q\napi HAS status: ?v\n```'
  const unreadable = new Error('unreadable')
  Object.defineProperty(unreadable, 'message', { get() { throw new Error('message unavailable') } })
  try {
    store.ingest('api HAS status: ready')
    for (const failure of [Object.create(null), unreadable]) {
      let attempts = 0
      t.mock.method(store.db, 'prepare', () => { attempts++; throw failure })
      const failed = report(store, template, { maxSensitivity: 'restricted' })
      assert.deepEqual(failed.problems, [
        { line: 1, message: '[unprintable thrown value]' },
        { line: 4, message: '[unprintable thrown value]' }
      ])
      assert.equal(attempts, 2, 'each query occurrence reports its own failure')
      assert.equal(failed.citations, 0)
      t.mock.restoreAll()
      const recovered = report(store, template, { maxSensitivity: 'restricted' })
      assert.deepEqual(recovered.problems, [])
      assert.equal(recovered.citations, 1)
      assert.match(recovered.markdown, /ready/)
    }
  } finally {
    t.mock.restoreAll()
    store.close()
  }
})

test('restricted reports keep all queries and citations on one read snapshot', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cave-report-snapshot-'))
  const path = join(directory, 'knowledge.db')
  const writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('api HAS status: ready\napi HAS owner: team-one')
  const reader = open(path, { access: 'read-only' })
  const template = 'Status: `cave-q: api HAS status: ?v`\nOwner: `cave-q: api HAS owner: ?v`'
  try {
    const expected = report(reader, template, { maxSensitivity: 'restricted' })
    assert.equal(expected.citations, 2)
    const prepare = reader.db.prepare.bind(reader.db)
    let committed = false
    t.mock.method(reader.db, 'prepare', (sql: string) => {
      if (!committed && sql === 'SELECT context FROM cave_context WHERE claim_id = ?') {
        committed = true
        writer.ingest('api HAS status: updated\napi HAS owner: team-two')
      }
      return prepare(sql)
    })
    const first = report(reader, template, { maxSensitivity: 'restricted' })
    assert.equal(committed, true)
    assert.deepEqual(first, expected)
    const next = report(reader, template, { maxSensitivity: 'restricted' })
    assert.deepEqual(next.problems, [])
    assert.equal(next.citations, 2)
    assert.match(next.markdown, /Status: updated/)
    assert.match(next.markdown, /Owner: team-two/)
    assert.doesNotMatch(next.markdown, /ready|team-one/)
  } finally {
    reader.close()
    writer.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

/**
 * A store exercising every §31 construct: repeated solutions for query
 * blocks, one uncontested attribute for the inline splice, one fact
 * contested across sources (§26 resolution is the fix), a transitive
 * chain (solutions without rows), and an alias pair for the closure.
 */
const fixture = () => {
  const store = open()
  store.ingest(`
api-gateway IS service
checkout IS service
api-gateway HAS owner: platform-team @src:cli
checkout HAS owner: payments-team @src:cli
checkout HAS owner: shop-team @src:audit
acme HAS revenue: ~20B USD/yr @src:cli @ 90%
microservice EXTENDS service
api-gateway IS microservice
billing USES postgres
postgres ALIAS postgresql
analytics USES postgresql
`)
  return store
}

const today = (): string => new Date().toISOString().slice(0, 10)

test('large blank prefixes preserve report block locations and fragment rendering', () => {
  const store = fixture()
  try {
    const blanks = '\n'.repeat(10_000)
    const empty = report(store, `\`\`\`cave-q\n${blanks}\n\`\`\``)
    const problem = empty.problems[0]
    assert.ok(problem)
    assert.equal(problem.line, 10_003)
    assert.match(problem.message, /empty cave-q block/)
    const pattern = '?service IS service'
    const padded = report(store, `\`\`\`cave-q\n${blanks}${pattern}\n${blanks}- ?service\n\`\`\``)
    const compact = report(store, `\`\`\`cave-q\n${pattern}\n- ?service\n\`\`\``)
    assert.deepEqual(padded, compact)
  } finally { store.close() }
})

test('markdown without live constructs passes through verbatim (spec §31.1)', () => {
  const store = fixture()
  const template = '# Title\n\nProse with a `code span` and ?tokens.\n'
  const rendered = report(store, template)
  assert.equal(rendered.markdown, template)
  assert.equal(rendered.citations, 0)
  assert.deepEqual(rendered.problems, [])
  store.close()
})

test('reports default to internal and accept an explicit sensitivity ceiling (spec §9.7, §31)', () => {
  const store = open()
  store.ingest([
    'public-service IS service #sensitivity:public',
    'internal-service IS service',
    'secret-service IS service #sensitivity:confidential'
  ].join('\n'))
  const template = '```cave-q\n?svc IS service\n- ?svc\n```'
  const ordinary = report(store, template)
  assert.match(ordinary.markdown, /public-service/)
  assert.match(ordinary.markdown, /internal-service/)
  assert.doesNotMatch(ordinary.markdown, /secret-service/)
  const publicOnly = report(store, template, { maxSensitivity: 'public' })
  assert.match(publicOnly.markdown, /public-service/)
  assert.doesNotMatch(publicOnly.markdown, /internal-service|secret-service/)
  const confidential = report(store, template, { maxSensitivity: 'confidential' })
  assert.match(confidential.markdown, /secret-service/)
  store.close()
})

test('query block without a fragment renders cited bullets (spec §31.1)', () => {
  const store = fixture()
  const rendered = report(store, [
    '## Services',
    '',
    '```cave-q',
    '?svc IS service',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /- \?svc = api-gateway \[\^c1\]/)
  assert.match(rendered.markdown, /- \?svc = checkout \[\^c2\]/)
  // Footnote definitions: canonical line, tx date, claim key (spec §31.2).
  assert.match(rendered.markdown, /\[\^c1\]: `api-gateway IS service` — \d{4}-\d{2}-\d{2}, claim key `\["e:api-gateway","IS",0,"r:e:service",\[\]\]`/)
  assert.ok(rendered.markdown.includes(today()))
  assert.equal(rendered.citations, 2)
  store.close()
})

test('default fully bound bullets preserve surrounding raw claim spaces', () => {
  for (const spaces of [' ', '  ']) {
    const store = open()
    try {
      const raw = `${spaces}api IS service${spaces}`
      store.ingest(raw)
      const rendered = report(store, '```cave-q\napi IS service\n```')
      assert.deepEqual(rendered.problems, [])
      assert.ok(rendered.markdown.startsWith(`- \` ${raw} \` [^c1]\n`), rendered.markdown)
      assert.equal(rendered.citations, 1)
    } finally { store.close() }
  }
})

test('default bullets and citation footnotes survive declaration backticks', () => {
  const store = open()
  store.ingest('`left` EQUALS `right`')
  const rendered = report(store, [
    '```cave-q',
    '`left` EQUALS `right`',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /- `` `left` EQUALS `right` `` \[\^c1\]/)
  assert.match(rendered.markdown, /\[\^c1\]: `` `left` EQUALS `right` `` — \d{4}-\d{2}-\d{2}/)
  assert.equal(rendered.citations, 1)
  store.close()
})

test('fragment renders per solution with ?var substitution and [^?] placement', () => {
  const store = fixture()
  const rendered = report(store, [
    '| service | owner |',
    '|---|---|',
    '```cave-q',
    '?svc HAS owner: ?who @src:cli',
    '| ?svc | ?who [^?] |',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /\| api-gateway \| platform-team \[\^c1\] \|/)
  assert.match(rendered.markdown, /\| checkout \| payments-team \[\^c2\] \|/)
  // The header passed through above the rendered rows.
  assert.match(rendered.markdown, /\| service \| owner \|\n\|---\|---\|\n\| api-gateway/)
  store.close()
})

test('fragment without [^?] gets the citation appended to its last line', () => {
  const store = fixture()
  const rendered = report(store, [
    '```cave-q',
    'acme HAS revenue: ?v',
    'Revenue stands at **?v**.',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /Revenue stands at \*\*~20B USD\/yr\*\*\. \[\^c1\]/)
  // The canonical line in the citation carries the §9.5 stamp and confidence.
  assert.match(rendered.markdown, /\[\^c1\]: `acme HAS revenue: ~20B USD\/yr @src:cli @ 90%`/)
  store.close()
})

test('comparison condition citations use parseable canonical verbs', () => {
  const store = open()
  store.ingest('server CAUSE crash\n  WHEN latency <= 100ms')
  const rendered = report(store, [
    '```cave-q',
    'latency IS-AT-MOST 100ms',
    '- latency is capped at 100ms [^?]',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /- latency is capped at 100ms \[\^c1\]/)
  assert.match(rendered.markdown, /\[\^c1\]: `latency IS-AT-MOST 100ms`/)
  store.close()
})

test('WHERE filters ride with the block pattern (spec §12.2)', () => {
  const store = fixture()
  const rendered = report(store, [
    '```cave-q',
    '?svc HAS owner: ?who',
    'WHERE context = src:audit',
    '- ?who [^?]',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /- shop-team \[\^c1\]/)
  assert.doesNotMatch(rendered.markdown, /platform-team/)
  store.close()
})

test('report WHERE lines accept query whitespace and reject incomplete filters', () => {
  const store = fixture()
  try {
    for (const separator of ['\t', ' \t', '  ']) {
      const rendered = report(store, [
        '```cave-q', '?svc HAS owner: ?who',
        `WHERE${separator}context = src:audit`, '- ?who [^?]', '```'
      ].join('\n'))
      assert.deepEqual(rendered.problems, [])
      assert.equal(rendered.citations, 1)
      assert.equal(rendered.markdown.split('\n')[0], '- shop-team [^c1]')
      assert.doesNotMatch(rendered.markdown, /platform-team|payments-team|WHERE/)
    }
    const incomplete = report(store, '```cave-q\n?svc HAS owner: ?who\nWHERE\n- ?who\n```')
    assert.equal(incomplete.citations, 0)
    assert.equal(incomplete.problems.length, 1)
    assert.match(incomplete.problems[0]!.message, /expected.*WHERE/)
    assert.equal(incomplete.markdown, '*(invalid query)*\n')
    const prose = report(store, '```cave-q\ncheckout HAS owner: ?who\nWHEREVER ?who works [^?]\n```')
    assert.deepEqual(prose.problems, [])
    assert.match(prose.markdown, /WHEREVER payments-team works/)
    const separated = report(store, '```cave-q\ncheckout HAS owner: ?who\n\nWHERE ?who works [^?]\n```')
    assert.deepEqual(separated.problems, [])
    assert.match(separated.markdown, /WHERE payments-team works/)
  } finally { store.close() }
})

test('an unbound ?token passes through — fragments are prose (§29.3 convention)', () => {
  const store = fixture()
  const rendered = report(store, [
    '```cave-q',
    'acme HAS revenue: ?v',
    '?v — but what about ?margin?',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /~20B USD\/yr — but what about \?margin\?/)
  store.close()
})

test('a query with no solutions renders nothing — the honest empty section', () => {
  const store = fixture()
  const rendered = report(store, [
    '## Violations',
    '```cave-q',
    '?x HAS violation: ?v',
    '- ?x: ?v',
    '```',
    'End.'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.equal(rendered.markdown, '## Violations\nEnd.\n')
  assert.equal(rendered.citations, 0)
  store.close()
})

test('transitive solutions carry no row and cite nothing (§24.2 rule)', () => {
  const store = fixture()
  const rendered = report(store, [
    '```cave-q',
    'api-gateway IS+ ?type',
    '- reaches ?type [^?]',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /- reaches microservice\n/)
  assert.match(rendered.markdown, /- reaches service\n/)
  assert.equal(rendered.citations, 0)
  assert.doesNotMatch(rendered.markdown, /\[\^/)
  store.close()
})

for (const flag of ['aliases', 'resolve'] as const) {
  test(`report rejects malformed ${flag} settings before reading the store`, t => {
    const store = open()
    try {
      store.ingest('api HAS status: ready')
      const template = 'Status: `cave-q: api HAS status: ?v`'
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const tracked = t.mock.method(store.db, 'prepare', () => { throw new Error('unexpected database read') })
      for (const value of ['true', 'false', null, 0, 1, [], {}]) {
        assert.throws(() => report(store, template, { [flag]: value }), new RegExp(`${flag} must be a boolean`))
      }
      assert.equal(tracked.mock.callCount(), 0)
      tracked.mock.restore()
      const expected = report(store, template)
      assert.deepEqual(expected.problems, [])
      assert.deepEqual(report(store, template, { [flag]: false }), expected)
      assert.deepEqual(report(store, template, { [flag]: true }), expected)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  })
}

test('report captures query options once for all template queries', () => {
  const store = open()
  try {
    const initial = store.ingest('api HAS status: ready\napi HAS owner: team-one\napi ALIAS service')
    store.ingest('api HAS status: updated\napi HAS owner: team-two')
    const asOf = initial.ids.at(-1)!
    const template = 'Status: `cave-q: service HAS status: ?v`\nOwner: `cave-q: service HAS owner: ?v`'
    const expected = report(store, template, { aliases: true, asOf })
    assert.deepEqual(expected.problems, [])
    assert.match(expected.markdown, /Status: ready/)
    assert.match(expected.markdown, /Owner: team-one/)
    const reads = { aliases: 0, resolve: 0, asOf: 0, at: 0, maxSensitivity: 0 }
    const actual = report(store, template, {
      get aliases() { return ++reads.aliases === 1 },
      get resolve() { return ++reads.resolve !== 1 },
      get asOf() { return ++reads.asOf === 1 ? asOf : undefined },
      get at() { return ++reads.at === 1 ? undefined : 'invalid-time' },
      get maxSensitivity() { return ++reads.maxSensitivity === 1 ? 'internal' : 'restricted' }
    })
    assert.deepEqual(actual, expected)
    assert.deepEqual(reads, { aliases: 1, resolve: 1, asOf: 1, at: 1, maxSensitivity: 1 })
  } finally { store.close() }
})

test('repeated report queries retain fresh store/options and per-line failures', () => {
  const store = open()
  try {
    const first = store.ingest('api HAS status: ready')
    const template = 'First: `cave-q: api HAS status: ?v`\n\nSecond: `cave-q: api HAS status: ?v`\n'
    const ready = report(store, template)
    assert.ok(ready.markdown.startsWith('First: ready[^c1]\n\nSecond: ready[^c1]\n'))
    assert.equal(ready.citations, 1)
    store.ingest('api HAS status: updated')
    const updated = report(store, template)
    assert.ok(updated.markdown.startsWith('First: updated[^c1]\n\nSecond: updated[^c1]\n'))
    const historical = report(store, template, { asOf: first.ids[0]! })
    assert.ok(historical.markdown.startsWith('First: ready[^c1]\n\nSecond: ready[^c1]\n'))
    const invalid = report(store, template, { at: 'not-a-time' })
    assert.deepEqual(invalid.problems.map(problem => problem.line), [1, 3])
    assert.equal(invalid.citations, 0)
  } finally { store.close() }
})

test('repeated citations of one row share a footnote (spec §31.2)', () => {
  const store = fixture()
  const rendered = report(store, [
    '```cave-q',
    'acme HAS revenue: ?v',
    '```',
    '',
    'Inline again: `cave-q: acme HAS revenue: ?v`.'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /Inline again: ~20B USD\/yr\[\^c1\]\./)
  assert.equal(rendered.citations, 1)
  assert.equal(rendered.markdown.match(/\[\^c1\]:/g)?.length, 1)
  store.close()
})

test('report citations expose source-span links consistently (spec §9.8, §31.2)', () => {
  const store = open()
  store.ingest('api HAS owner: platform @src:https://example.com/design%20notes.md#L10-L12')
  const rendered = report(store, 'Owner: `cave-q: api HAS owner: ?owner`')
  assert.match(rendered.markdown,
    /source \[https:\/\/example\.com\/design notes\.md#L10-L12\]\(<https:\/\/example\.com\/design%20notes\.md#L10-L12>\)/)
  store.close()
})

test('report source links retain URL percent escapes through stored provenance', () => {
  const store = open()
  try {
    const source = 'https://example.com/design%20notes/a%2Fb?q=%25'
    store.ingest(`api HAS owner: platform @${SourceSpan.context(source, { startLine: 4, endLine: 5 })}`)
    const rendered = report(store, 'Owner: `cave-q: api HAS owner: ?owner`')
    assert.deepEqual(rendered.problems, [])
    assert.ok(rendered.markdown.includes(`[${source}#L4-L5](<${source}#L4-L5>)`), rendered.markdown)
  } finally { store.close() }
})

test('report source link labels escape Markdown and HTML punctuation literally', () => {
  const store = open()
  try {
    const source = 'https://example.com/a\\[b]/*notes*/_draft_/`code`/<b>&copy;'
    store.ingest(`api HAS owner: platform @${SourceSpan.context(source, { startLine: 4, endLine: 4 })}`)
    const rendered = report(store, 'Owner: `cave-q: api HAS owner: ?owner`')
    const label = 'https://example.com/a\\\\\\[b\\]/\\*notes\\*/\\_draft\\_/\\`code\\`/\\<b\\>\\&copy;#L4'
    assert.deepEqual(rendered.problems, [])
    assert.ok(rendered.markdown.includes(`[${label}](<`), rendered.markdown)
    assert.ok(rendered.markdown.includes('%3Cb%3E&amp;copy;#L4>)'), rendered.markdown)
  } finally { store.close() }
})

test('source citation controls cannot split footnotes or link labels', () => {
  for (const prefix of ['file-', 'https://example.com/']) {
    const store = open()
    try {
      const source = `${prefix}notes\n\ninjected\r\t\u0000\u007f\u0080\u0085\u009b\u009f\u2028\u2029`
      const context = SourceSpan.context(source, { startLine: 4, endLine: 4 })
      store.ingest(`api HAS owner: platform @${context}`)
      const rendered = report(store, 'Owner: `cave-q: api HAS owner: ?owner`')
      assert.deepEqual(rendered.problems, [])
      const footnote = rendered.markdown.slice(rendered.markdown.indexOf('[^c1]:')).trimEnd()
      assert.equal(footnote.split('\n').length, 1, prefix)
      assert.doesNotMatch(footnote, /[\r\t\u0000\u007f\u0080\u0085\u009b\u009f\u2028\u2029]/)
      const display = `${prefix}notes\\n\\ninjected\\r\\t\\u0000\\u007f\\u0080\\u0085\\u009b\\u009f\\u2028\\u2029#L4`
      if (prefix.startsWith('https')) {
        assert.ok(footnote.includes(`[${display.replaceAll('\\', '\\\\')}](<`), footnote)
        assert.ok(footnote.includes('%0A%0Ainjected%0D%09%00%7F%C2%80%C2%85%C2%9B%C2%9F%E2%80%A8%E2%80%A9#L4>'), footnote)
      } else {
        assert.ok(footnote.includes(`source \`${display}\``), footnote)
      }
      assert.equal(SourceSpan.parse(context)?.source, source)
    } finally { store.close() }
  }
})

test('large report fragments do not exceed function argument limits', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    const fragment = '- ?name\n'.repeat(150_000).trimEnd()
    const rendered = report(store, `\`\`\`cave-q\n?name IS service\n${fragment}\n\`\`\``)
    assert.deepEqual(rendered.problems, [])
    assert.equal(rendered.citations, 1)
    assert.equal(rendered.markdown.split('\n').filter(line => line.startsWith('- api')).length, 150_000)
    assert.ok(rendered.markdown.includes('- api [^c1]\n'))
  } finally { store.close() }
})

test('source code spans handle many backtick runs without argument spreading', () => {
  const store = open()
  try {
    const source = 'file-' + '`x'.repeat(150_000)
    store.ingest(`api IS service @${SourceSpan.context(source, { startLine: 1, endLine: 1 })}`)
    const rendered = report(store, 'Kind: `cave-q: api IS ?kind`')
    assert.deepEqual(rendered.problems, [])
    assert.equal(rendered.citations, 1)
    assert.ok(rendered.markdown.includes(`source \`\`${source}#L1\`\``))
  } finally { store.close() }
})

test('inline splice: one variable, one solution, value plus citation (spec §31.1)', () => {
  const store = fixture()
  const rendered = report(store, 'Revenue reached `cave-q: acme HAS revenue: ?v` this year.\n')
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /Revenue reached ~20B USD\/yr\[\^c1\] this year\./)
  assert.equal(rendered.citations, 1)
  store.close()
})

test('inline splice: contested fact is ambiguous; --resolve picks the §26 winner', () => {
  const store = fixture()
  const ambiguous = report(store, 'Owner: `cave-q: checkout HAS owner: ?who`\n')
  assert.equal(ambiguous.problems.length, 1)
  assert.match(ambiguous.problems[0]!.message, /ambiguous.*2 matches.*--resolve/s)
  assert.equal(ambiguous.problems[0]!.line, 1)
  assert.match(ambiguous.markdown, /Owner: \*\(ambiguous: 2 matches\)\*/)

  // src:cli (class 4) outranks the content source (root class 2).
  const resolved = report(store, 'Owner: `cave-q: checkout HAS owner: ?who`\n', { resolve: true })
  assert.deepEqual(resolved.problems, [])
  assert.match(resolved.markdown, /Owner: payments-team\[\^c1\]/)
  store.close()
})

test('inline splice: no match and wrong variable count are problems', () => {
  const store = fixture()
  const rendered = report(store, [
    'Missing: `cave-q: nobody HAS nothing: ?x`',
    'Two vars: `cave-q: ?svc HAS owner: ?who`',
    'No vars: `cave-q: api-gateway IS service`'
  ].join('\n'))
  assert.equal(rendered.problems.length, 3)
  assert.match(rendered.problems[0]!.message, /no match/)
  assert.equal(rendered.problems[0]!.line, 1)
  assert.match(rendered.problems[1]!.message, /exactly one \?variable, got 2/)
  assert.equal(rendered.problems[1]!.line, 2)
  assert.match(rendered.problems[2]!.message, /exactly one \?variable, got 0/)
  assert.match(rendered.markdown, /Missing: \*\(no match\)\*/)
  assert.match(rendered.markdown, /Two vars: \*\(invalid query\)\*/)
  store.close()
})

test('inline splice: longer delimiters carry a backtick code literal (spec §31.1)', () => {
  const store = open()
  store.ingest('config HAS default: `null`')
  const rendered = report(store, 'Default set on ``cave-q: ?who HAS default: `null` ``.\n')
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /Default set on config\[\^c1\]\./)
  assert.equal(rendered.citations, 1)
  // The cited canonical line carries a backtick run, so its footnote
  // definition needs a longer delimiter (and padding) to stay a valid span.
  assert.match(rendered.markdown, /\[\^c1\]: `` config HAS default: `null` `` — \d{4}-\d{2}-\d{2}/)
  store.close()
})

test('inline splice: padded delimiters strip one space each side (CommonMark)', () => {
  const store = fixture()
  const rendered = report(store, 'Revenue: `` cave-q: acme HAS revenue: ?v ``.\n')
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /Revenue: ~20B USD\/yr\[\^c1\]\./)
  store.close()
})

test('a code span quoting the splice syntax stays literal', () => {
  const store = fixture()
  const template = 'The construct is `` `cave-q: <pattern>` `` in prose.\n'
  const rendered = report(store, template)
  assert.deepEqual(rendered.problems, [])
  assert.equal(rendered.markdown, template)
  assert.equal(rendered.citations, 0)
  store.close()
})

test('inline splices follow parsed escapes and multiline code-span boundaries', () => {
  const store = fixture()
  try {
    for (const template of [
      '\\`cave-q: acme HAS revenue: ?v\\`\n',
      'Example: `` first\n`cave-q: acme HAS revenue: ?v`\nlast ``.\n',
      '[reference]: /example "`cave-q: acme HAS revenue: ?v`"\n'
    ]) {
      const result = report(store, template)
      assert.equal(result.markdown, template)
      assert.equal(result.citations, 0)
      assert.deepEqual(result.problems, [])
    }
    for (const template of [
      'Revenue: `cave-q: acme HAS\nrevenue: ?v`.\n',
      'Revenue: `` cave-q: acme HAS\nrevenue: ?v ``.\n',
      'Revenue: `cave-q: acme HAS\r\nrevenue: ?v`.\r\n',
      'Revenue: `cave-q: acme HAS\rrevenue: ?v`.\r',
      'Revenue: `\ncave-q: acme HAS revenue: ?v\n`.\n'
    ]) {
      const result = report(store, template)
      assert.ok(result.markdown.startsWith('Revenue: ~20B USD/yr[^c1].\n'), result.markdown)
      assert.equal(result.citations, 1)
      assert.deepEqual(result.problems, [])
    }
    const repeated = report(store, 'A `cave-q: acme HAS\nrevenue: ?v` B `cave-q: acme HAS revenue: ?v` C.\n')
    assert.ok(repeated.markdown.startsWith('A ~20B USD/yr[^c1] B ~20B USD/yr[^c1] C.\n'))
    const container = report(store, '> Revenue: `cave-q: acme HAS\n> revenue: ?v`.\n')
    assert.ok(container.markdown.startsWith('> Revenue: ~20B USD/yr[^c1].\n'))
    const invalid = report(store, 'Heading\n\nValue: `cave-q: missing HAS\nrevenue: ?v`.\n')
    assert.equal(invalid.problems[0]?.line, 3)
  } finally { store.close() }
})

test('a stray backtick before a splice keeps CommonMark span boundaries', () => {
  const store = fixture()
  // The first span is ` then ` — the following cave-q: text sits outside
  // any code span (its backtick never closes), so nothing splices.
  const template = 'Tick ` then `cave-q: acme HAS revenue: ?v` done.\n'
  const rendered = report(store, template)
  assert.deepEqual(rendered.problems, [])
  assert.equal(rendered.markdown, template)
  assert.equal(rendered.citations, 0)
  store.close()
})

test('aliases widen matching when opted in (spec §13.6)', () => {
  const store = fixture()
  const plain = report(store, '```cave-q\n?x USES postgres\n- ?x\n```\n')
  assert.doesNotMatch(plain.markdown, /analytics/)
  const closed = report(store, '```cave-q\n?x USES postgres\n- ?x\n```\n', { aliases: true })
  assert.match(closed.markdown, /- billing/)
  assert.match(closed.markdown, /- analytics/)
  store.close()
})

test('asOf renders the report at a past boundary (spec §12.3)', () => {
  const store = open()
  const first = store.ingest('acme HAS revenue: 10B USD/yr @src:cli')
  store.ingest('acme HAS revenue: 20B USD/yr @src:cli')
  const now = report(store, 'Revenue: `cave-q: acme HAS revenue: ?v`\n')
  assert.match(now.markdown, /Revenue: 20B USD\/yr/)
  const then = report(store, 'Revenue: `cave-q: acme HAS revenue: ?v`\n', { asOf: first.ids[0]! })
  assert.deepEqual(then.problems, [])
  assert.match(then.markdown, /Revenue: 10B USD\/yr/)
  store.close()
})

test('raw HTML blocks and inline HTML attributes keep query examples literal', () => {
  const store = fixture()
  try {
    const splice = '`cave-q: acme HAS revenue: ?v`'
    const block = '```cave-q\nacme HAS revenue: ?v\n```'
    for (const example of [
      `<!--\n${splice}\n${block}\n-->`,
      `<pre>\n${splice}\n${block}\n</pre>`,
      `<script>\n${splice}\n${block}\n</script>`,
      `<style>\n${splice}\n${block}\n</style>`,
      `<div>\n${splice}\n${block}\n</div>`,
      `<?instruction\n${splice}\n${block}\n?>`,
      `<![CDATA[\n${splice}\n${block}\n]]>`,
      `> <!--\n> ${splice}\n> -->`
    ]) {
      const literal = report(store, `${example}\n`)
      assert.equal(literal.markdown, `${example}\n`)
      assert.equal(literal.citations, 0)
      assert.deepEqual(literal.problems, [])
      const rendered = report(store, `${example}\n\nLive: ${splice}\n`)
      assert.deepEqual(rendered.problems, [], example)
      assert.ok(rendered.markdown.startsWith(`${example}\n\nLive: ~20B USD/yr[^c1]\n`), rendered.markdown)
      assert.equal(rendered.citations, 1)
    }
    for (const example of [
      `<span title="${splice}">label</span>`,
      `<!-- ${splice} -->`,
      '<span title="`">label</span>',
      `<!-- first\n${splice}\nlast -->`
    ]) {
      const rendered = report(store, `Before ${example} after ${splice}\n`)
      assert.deepEqual(rendered.problems, [], example)
      assert.ok(rendered.markdown.startsWith(`Before ${example} after ~20B USD/yr[^c1]\n`), rendered.markdown)
      assert.equal(rendered.citations, 1)
    }
    const nested = report(store, `Prose <span>${splice}</span>\n`)
    assert.match(nested.markdown, /Prose <span>~20B USD\/yr\[\^c1\]<\/span>/)
    assert.deepEqual(nested.problems, [])
    const resumed = report(store, `<div>\n${splice}\n\nLive: ${splice}\n`)
    assert.ok(resumed.markdown.startsWith(`<div>\n${splice}\n\nLive: ~20B USD/yr[^c1]\n`))
    const crlf = report(store, `<!--\r\n${splice}\r\n-->\r\n\r\nLive: ${splice}\r\n`)
    assert.ok(crlf.markdown.startsWith(`<!--\n${splice}\n-->\n\nLive: ~20B USD/yr[^c1]\n`))
  } finally { store.close() }
})

test('indented code examples remain inert across tabs, containers and blank lines', () => {
  const store = fixture()
  try {
    const splice = '`cave-q: acme HAS revenue: ?v`'
    for (const example of [
      `    ${splice}`, `\t${splice}`,
      `    ${splice}\n\n    ${splice}`,
      `- Example:\n\n      ${splice}`,
      `>     ${splice}`,
      `    \`\`\`cave-q\n    acme HAS revenue: ?v\n    \`\`\``
    ]) {
      const template = `${example}\n\nLive: ${splice}\n`
      const rendered = report(store, template)
      assert.deepEqual(rendered.problems, [])
      assert.ok(rendered.markdown.startsWith(`${example}\n\nLive: ~20B USD/yr[^c1]\n`), rendered.markdown)
      assert.equal(rendered.citations, 1)
    }
    assert.equal(report(store, `    ${splice}`).citations, 0)
  } finally { store.close() }
})

test('indented paragraph and list continuations retain live inline splices', () => {
  const store = fixture()
  try {
    const splice = '`cave-q: acme HAS revenue: ?v`'
    for (const prefix of ['Paragraph\n    ', '- Item\n    ', '- Item\n\n    ']) {
      const rendered = report(store, `${prefix}${splice}`)
      assert.deepEqual(rendered.problems, [])
      assert.ok(rendered.markdown.startsWith(`${prefix}~20B USD/yr[^c1]\n`), rendered.markdown)
      assert.equal(rendered.citations, 1)
    }
  } finally { store.close() }
})

test('footnote paragraphs retain live splices while their nested code stays inert', () => {
  const store = fixture()
  try {
    const splice = '`cave-q: acme HAS revenue: ?v`'
    for (const indent of ['    ', '\t']) {
      const template = `Text[^note].\n\n[^note]: First paragraph.\n\n${indent}Live: ${splice}\n\n${indent}${indent}${splice}\n\nDone.\n`
      const rendered = report(store, template)
      assert.deepEqual(rendered.problems, [])
      assert.ok(rendered.markdown.includes(`${indent}Live: ~20B USD/yr[^c1]\n`), rendered.markdown)
      assert.ok(rendered.markdown.includes(`${indent}${indent}${splice}\n`), rendered.markdown)
      assert.equal(rendered.citations, 1)
    }
  } finally { store.close() }
})

test('only parsed top-level fences execute report query blocks', () => {
  const store = fixture()
  try {
    const splice = '`cave-q: acme HAS revenue: ?v`'
    for (const example of [
      '```cave-q invalid`info',
      '- Example:\n\n  ```cave-q\n  acme HAS revenue: ?v\n  ```',
      '> ```cave-q\n> acme HAS revenue: ?v\n> ```',
      '[^note]: Example\n\n    ```cave-q\n    acme HAS revenue: ?v\n    ```'
    ]) {
      const result = report(store, `${example}\n\nLive: ${splice}\n`)
      assert.deepEqual(result.problems, [], example)
      assert.ok(result.markdown.startsWith(`${example}\n\nLive: ~20B USD/yr[^c1]\n`), result.markdown)
      assert.equal(result.citations, 1)
    }
    for (const suffix of ['\u00a0', '\u2003']) {
      const result = report(store, `\`\`\`cave-q\nacme HAS revenue: ?v\n\`\`\`${suffix}`)
      assert.ok(result.problems.some(problem => problem.message === 'unclosed cave-q block'))
      assert.ok(result.markdown.includes(`\`\`\`${suffix}`))
    }
  } finally { store.close() }
})

test('other fenced blocks pass through verbatim, splices inside them inert', () => {
  const store = fixture()
  const template = [
    '```cave',
    'auth USES jwt @ 90%',
    '```',
    '~~~',
    'Inert: `cave-q: acme HAS revenue: ?v`',
    '~~~'
  ].join('\n')
  const rendered = report(store, template)
  assert.deepEqual(rendered.problems, [])
  assert.equal(rendered.markdown, `${template}\n`)
  assert.equal(rendered.citations, 0)
  store.close()
})

test('a failing query block is marked in place, not vanished (spec §31.3)', () => {
  const store = fixture()
  const rendered = report(store, [
    'Before.',
    '```cave-q',
    'not-even a-pattern extra tokens here',
    '```',
    'After.'
  ].join('\n'))
  assert.equal(rendered.problems.length, 1)
  assert.equal(rendered.problems[0]!.line, 3)
  // §31.3: the rendered document still emits, problems marked in place —
  // the block must not silently vanish from the output.
  assert.equal(rendered.markdown, 'Before.\n*(invalid query)*\nAfter.\n')
  store.close()
})

test('an empty query block is marked in place, not vanished (spec §31.3)', () => {
  const store = fixture()
  const rendered = report(store, [
    'Before.',
    '```cave-q',
    '```',
    'After.'
  ].join('\n'))
  assert.equal(rendered.problems.length, 1)
  assert.match(rendered.problems[0]!.message, /empty cave-q block/)
  assert.equal(rendered.markdown, 'Before.\n*(invalid query)*\nAfter.\n')
  store.close()
})

for (const [name, ending] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r']] as const)
test(`problems: bad pattern, empty block, unclosed fence retain ${name} template lines`, () => {
  const store = fixture()
  const rendered = report(store, [
    'Intro.',
    '```cave-q',
    'not-even a-pattern extra tokens here',
    '```',
    '```cave-q',
    '```',
    '```cave-q',
    '?svc IS service'
  ].join(ending))
  assert.equal(rendered.problems.length, 3)
  assert.deepEqual(rendered.problems.map(problem => problem.line), [3, 6, 7])
  assert.equal(rendered.markdown.includes('\r'), false)
  assert.match(rendered.problems[1]!.message, /empty cave-q block/)
  assert.match(rendered.problems[2]!.message, /unclosed cave-q block/)
  // The unclosed block still renders its solutions.
  assert.match(rendered.markdown, /- \?svc = api-gateway/)
  store.close()
})

test('longer variable names substitute before shorter prefixes', () => {
  const store = open()
  store.ingest('a REL b')
  const rendered = report(store, '```cave-q\n?x REL ?xl\n?x and ?xl [^?]\n```\n')
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /a and b \[\^c1\]/)
  store.close()
})

test('fragment substitution preserves unknown Unicode variable names', () => {
  const store = open()
  try {
    store.ingest('a REL b')
    const unknown = ['?xéextra', '?x𐐀', '?x١', '?x\u0301', '?x東京']
    const rendered = report(store, '```cave-q\n?x REL ?xé\n?x and ?xé; ' + unknown.join(' ') + ' [^?]\n```')
    assert.deepEqual(rendered.problems, [])
    assert.equal(rendered.markdown.split('\n')[0], 'a and b; ' + unknown.join(' ') + ' [^c1]')
  } finally { store.close() }
})

test('report bindings remain literal when they contain variables or citation placeholders', () => {
  const store = open()
  try {
    store.ingest('a REL "?x [^?] $&"')
    for (const fragment of ['?x and ?xl [^?]', '?x and ?xl', '']) {
      const result = report(store, `\`\`\`cave-q\n?x REL ?xl\n${fragment}\n\`\`\``)
      assert.deepEqual(result.problems, [])
      const body = result.markdown.split('\n\n')[0]!
      assert.ok(body.includes('"?x [^?] $&"'), body)
      assert.ok(body.endsWith(' [^c1]'), body)
      assert.equal(result.citations, 1)
    }
    const transitive = report(store, '```cave-q\n?x REL+ ?xl\n?x and ?xl [^?]\n```')
    assert.deepEqual(transitive.problems, [])
    assert.equal(transitive.markdown, 'a and "?x [^?] $&"\n')
    assert.equal(transitive.citations, 0)
  } finally {
    store.close()
  }
})

test('generated citations skip existing template labels and reuse the same row label', () => {
  const store = open()
  try {
    store.ingest('a IS service\nb IS service')
    const result = report(store, [
      'Existing [^c1] and [^C2]. Example `[^c3]`.',
      '```cave-q', '?s IS service', '- ?s [^?]', '```',
      'Again: `cave-q: a IS ?kind`',
      '[^c1]: First authored footnote.', '[^C2]: Second authored footnote.'
    ].join('\n'))
    assert.deepEqual(result.problems, [])
    assert.equal(result.citations, 2)
    assert.match(result.markdown, /- a \[\^c4\]/)
    assert.match(result.markdown, /- b \[\^c5\]/)
    assert.match(result.markdown, /Again: service\[\^c4\]/)
    assert.equal(result.markdown.match(/\[\^c4\]:/g)?.length, 1)
    assert.match(result.markdown, /\[\^c1\]: First authored footnote\./)
    assert.match(result.markdown, /\[\^C2\]: Second authored footnote\./)
  } finally {
    store.close()
  }
})


test('citation comments fold LF, CRLF and CR line endings without changing stored text', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const store = open()
    try {
      const comment = `first${ending}second${ending}third`
      const parsed = canonicalizeText('api IS service', store.registry())
      store.insertResult({ ...parsed, claims: parsed.claims.map(entry => ({
        ...entry, claim: { ...entry.claim, comment }
      })) })
      const before = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
      const rendered = report(store, 'Status: `cave-q: api IS ?kind`')
      assert.deepEqual(rendered.problems, [])
      assert.equal(rendered.citations, 1)
      assert.ok(rendered.markdown.includes('; first / second / third`'), rendered.markdown)
      assert.equal(rendered.markdown.includes('\r'), false)
      assert.equal(rendered.markdown.split('\n').filter(line => line.startsWith('[^c1]:')).length, 1)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), before)
    } finally { store.close() }
  }
})

test('citation dates retain expanded ISO years throughout the UUID timestamp range', () => {
  for (const [ms, date] of [
    [Date.parse('9999-12-31T23:59:59.999Z'), '9999-12-31'],
    [Date.parse('+010000-01-01T00:00:00.000Z'), '+010000-01-01'],
    [2 ** 48 - 1, '+010889-08-02']
  ] as const) {
    const store = open()
    try {
      const id = Uuidv7.at(ms, 0, new Uint8Array(8))
      store.insertResult(canonicalizeText('api IS service', store.registry()), { ids: [id] })
      const rendered = report(store, '```cave-q\napi IS service\n```')
      assert.deepEqual(rendered.problems, [])
      assert.equal(rendered.citations, 1)
      assert.ok(rendered.markdown.includes(` — ${date}, claim key `), rendered.markdown)
    } finally { store.close() }
  }
})

test('reports reject unnamed variables without rewriting prose question marks', () => {
  const store = open()
  try {
    store.ingest('a REL b')
    const invalid = report(store, '```cave-q\n? REL b\nReady? [^?]\n```')
    assert.equal(invalid.problems.length, 1)
    assert.match(invalid.problems[0]!.message, /variable requires a name/)
    assert.equal(invalid.citations, 0)
    const corrected = report(store, '```cave-q\n?name REL b\n?name is ready? [^?]\n```')
    assert.deepEqual(corrected.problems, [])
    assert.ok(corrected.markdown.startsWith('a is ready? [^c1]'))
    assert.equal(corrected.citations, 1)
  } finally { store.close() }
})


test('stored Markdown and query-looking text are inserted without another report evaluation', () => {
  const store = open()
  try {
    const value = '"**bold** [link](https://example.test) `cave-q: other HAS code: ?code` ?value [^?]"'
    store.ingest(`entry HAS body: ${value}\nother HAS code: "second-query-result"`)
    const templates = [
      '```cave-q\nentry HAS body: ?value\n?value [^?]\n```',
      '```cave-q\nentry HAS body: ?value\n```',
      'Body: `cave-q: entry HAS body: ?value`',
    ]
    for (const template of templates) {
      const rendered = report(store, template)
      assert.deepEqual(rendered.problems, [])
      assert.equal(rendered.citations, 1)
      assert.ok(rendered.markdown.split('\n')[0]!.includes(value), rendered.markdown)
      assert.ok(!rendered.markdown.includes('second-query-result'), rendered.markdown)
      assert.equal(rendered.markdown.match(/^\[\^c1\]:/gm)?.length, 1)
    }
  } finally { store.close() }
})

test('invalid HTTP source locations render as plain citations and preserve stored provenance', () => {
  const store = open()
  try {
    for (const [index, source] of ['https://', 'https://[bad]/', 'https://exa mple.com/', 'https://example.com:99999/'].entries()) {
      const context = SourceSpan.context(source, { startLine: 2, endLine: 3 })
      store.ingest(`api${index} HAS owner: platform @${context}`)
      const rendered = report(store, `Owner: \`cave-q: api${index} HAS owner: ?owner\``)
      assert.deepEqual(rendered.problems, [])
      assert.ok(rendered.markdown.includes(`source \`${source}#L2-L3\``), rendered.markdown)
      assert.ok(store.exportText().includes(context))
    }
  } finally { store.close() }
})

test('prototype-named report variables retain literal values and citations', () => {
  const store = open()
  try {
    store.ingest('api HAS owner: "literal ?constructor [^?] $&"')
    for (const name of ['__proto__', 'constructor', 'toString']) {
      const block = report(store, ['```cave-q', `api HAS owner: ?${name}`, `Owner: ?${name} [^?]`, '```'].join('\n'))
      assert.deepEqual(block.problems, [])
      assert.equal(block.markdown.split('\n')[0], 'Owner: "literal ?constructor [^?] $&" [^c1]')
      assert.equal(block.citations, 1)
      const inline = report(store, `Owner: \`cave-q: api HAS owner: ?${name}\``)
      assert.deepEqual(inline.problems, [])
      assert.equal(inline.markdown.split('\n')[0], 'Owner: "literal ?constructor [^?] $&"[^c1]')
      assert.equal(inline.citations, 1)
    }
  } finally { store.close() }
})
