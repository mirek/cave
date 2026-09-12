import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import initSqlJs from 'sql.js'
import { page, query, queryRecords, Record as QueryRecord } from '@cavelang/query'
import { SourceSpan } from '@cavelang/core'
import { openWith, Record as ClaimRecord } from '@cavelang/store/adapter'
import { createSqlJsAdapter } from '../src/playground/sqlite-adapter.ts'
import { openPlaygroundDatabase } from '../src/playground/open-database.ts'
import { describeWorkerError, SqliteInitializationError } from '../src/playground/errors.ts'
import { DatabaseCleanupError, replaceDatabase } from '../src/playground/replace-database.ts'
import { sqliteAdapterContract } from '../../packages/store/test/adapter-contract.ts'
import { docEditHref, docHref } from '../src/lib/doc-links.ts'
import { check, evaluate, gatedIngest } from '../../packages/shape/src/index.ts'

test('documentation links resolve relative files, directory READMEs, and sections', () => {
  const docs = [
    { slug: 'overview', source: 'README.md' },
    { slug: 'store', source: 'packages/store/README.md' },
    { slug: 'query', source: 'packages/query/README.md' },
  ]
  const source = 'packages/store/README.md'
  assert.equal(docHref('#transactions', source, docs), '#/docs/store#transactions')
  assert.equal(docHref('../query', source, docs), '#/docs/query')
  assert.equal(docHref('../query/README.md#filters', source, docs), '#/docs/query#filters')
  assert.equal(docHref('../../README.md#where-next', source, docs), '#/docs/overview#where-next')
  assert.equal(docHref('packages/store/', 'README.md', docs), '#/docs/store')
  assert.equal(docHref('./', 'README.md', docs), '#/docs/overview')
  assert.equal(docHref('/License.md', source, docs), 'https://github.com/mirek/cave/blob/main/License.md')
  assert.equal(docHref('./src/index.ts', source, docs), 'https://github.com/mirek/cave/blob/main/packages/store/src/index.ts')
  for (const href of [undefined, 'https://example.com/#section', 'mailto:hello@example.com', '//example.com/page', '#/docs/cli']) {
    assert.equal(docHref(href, source, docs), href)
  }
  assert.equal(docHref('./bad%escape.md', source, docs), 'https://github.com/mirek/cave/blob/main/packages/store/bad%escape.md')
})

const require = createRequire(import.meta.url)

test('documentation routing preserves query semantics and matches encoded repository paths', () => {
  const docs = [
    { slug: 'overview', source: 'README.md' },
    { slug: 'query', source: 'packages/query/README.md' },
    { slug: 'guide', source: 'docs/User Guide.md' }
  ]
  const source = 'packages/store/README.md'
  assert.equal(docHref('../query/%52EADME.md#filters', source, docs), '#/docs/query#filters')
  assert.equal(docHref('/docs/User%20Guide.md#first-step', source, docs), '#/docs/guide#first-step')
  assert.equal(docHref('/README.md#where-next', source, docs), '#/docs/overview#where-next')
  assert.equal(docHref('../query/README.md?plain=1#filters', source, docs),
    'https://github.com/mirek/cave/blob/main/packages/query/README.md?plain=1#filters')
  assert.equal(docHref('?plain=1', source, docs),
    'https://github.com/mirek/cave/blob/main/packages/store/README.md?plain=1')
  assert.equal(docHref('#first-step', 'docs/User Guide.md', docs), '#/docs/guide#first-step')
})
test('documentation filenames preserve literal URL punctuation without decoding path separators', () => {
  const source = 'docs/FAQ#advanced?100%.md'
  const docs = [
    { slug: 'faq', source },
    { slug: 'guide', source: 'docs/guide.md' }
  ]
  assert.equal(docHref('/docs/FAQ%23advanced%3F100%25.md#answer', 'README.md', docs), '#/docs/faq#answer')
  assert.equal(docHref('#answer', source, docs), '#/docs/faq#answer')
  assert.equal(docHref('./guide.md', source, docs), '#/docs/guide')
  assert.equal(docHref('/docs%2Fguide.md', 'README.md', docs), 'https://github.com/mirek/cave/blob/main/docs%2Fguide.md')
  const edit = new URL(docEditHref(source))
  assert.equal(decodeURIComponent(edit.pathname), `/mirek/cave/edit/main/${source}`)
  assert.equal(edit.search, '')
  assert.equal(edit.hash, '')
})

const sqlite = await initSqlJs({
  locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
})
const adapter = createSqlJsAdapter(sqlite)

test('closed WASM databases reject new and retained statement operations clearly', () => {
  const db = adapter.open(':memory:')
  const statement = db.prepare('SELECT 1 AS value')
  db.close()
  for (const read of [() => db.exec('SELECT 1'), () => db.prepare('SELECT 1'),
    () => statement.get(), () => statement.all(), () => statement.run()]) {
    assert.throws(read, /SQLite WASM database is closed/)
  }
  assert.doesNotThrow(() => db.close())
})

test('failed native WASM close can be retried without marking the database closed', t => {
  const db = adapter.open(':memory:')
  const failure = new Error('native close interrupted')
  const interception = t.mock.method(sqlite.Database.prototype, 'close', () => { throw failure })
  try {
    assert.throws(() => db.close(), error => error === failure)
    assert.equal(db.prepare('SELECT 1 AS value').get()!.value, 1)
  } finally { interception.mock.restore(); db.close() }
  assert.throws(() => db.prepare('SELECT 1'), /database is closed/)
})

test('failed replacement ingestion preserves the working WASM database and closes the candidate', () => {
  const current = openWith(adapter), replacement = openWith(adapter)
  try {
    current.ingest('retained IS service')
    const before = current.exportText({ tx: true })
    assert.throws(() => replaceDatabase(current, replacement, () => {
      replacement.ingest('this is not a valid claim', { strict: true })
    }), error => error instanceof Error && !(error instanceof DatabaseCleanupError) && /CAVE ingest failed/.test(error.message))
    assert.equal(current.exportText({ tx: true }), before)
    assert.equal(query(current, '?x IS service')[0]!.bindings.x, 'retained')
    assert.throws(() => replacement.currentBeliefs(), /closed/i)
  } finally { replacement.close(); current.close() }
})

for (const replacementCleanupFails of [false, true]) {
  test(`WASM replacement retires both stores after old-store close fails (candidate failure=${replacementCleanupFails})`, () => {
    const current = openWith(adapter), replacement = openWith(adapter)
    const oldError = new Error('old store observer failed'), replacementError = new Error('replacement observer failed')
    try {
      current.ingest('original IS service')
      current.onClose(() => { throw oldError })
      if (replacementCleanupFails) replacement.onClose(() => { throw replacementError })
      assert.throws(() => replaceDatabase(current, replacement, () => {
        replacement.ingest('candidate IS service')
        return replacement.currentBeliefs().length
      }), error => {
        assert.ok(error instanceof DatabaseCleanupError)
        assert.deepEqual(error.errors, replacementCleanupFails ? [oldError, replacementError] : [oldError])
        assert.equal(error.cause, oldError)
        return true
      })
      assert.throws(() => current.currentBeliefs(), /closed/i)
      assert.throws(() => replacement.currentBeliefs(), /closed/i)
      const retry = openWith(adapter)
      try { retry.ingest('retry IS service'); assert.equal(query(retry, '?x IS service')[0]!.bindings.x, 'retry') }
      finally { retry.close() }
    } finally { replacement.close(); current.close() }
  })
}

test('WASM claim and query records satisfy value projection decoding', () => {
  const store = openWith(adapter)
  try {
    const values = ['42 ms', '~20 ms +/- 2 ms (3σ)', '100 -> 999.99 req/s @2025..2027',
      '2026-Q1', 'platform', '"42"', '`42`', '9'.repeat(400)]
    store.ingest(values.map((value, index) => `item-${index} HAS value: ${value}`).join('\n'), { strict: true })
    const rows = store.currentBeliefs()
    assert.equal(rows.length, values.length)
    for (const row of rows) {
      const record = store.recordOf(row)
      assert.deepEqual(ClaimRecord.decode(ClaimRecord.encode(record)), record)
    }
    const matches = queryRecords(store, '?item HAS value: ?n', { at: '2026' })
    assert.equal(matches.length, values.length)
    for (const match of matches) assert.deepEqual(QueryRecord.decode(QueryRecord.encode(match)), match)
    const interpolated = matches.find(match => match.bindings['item'] === 'item-2')!
    assert.equal(interpolated.at!.num, 549.995)
    assert.equal(interpolated.at!.text, '550 req/s')
    const scalar = matches.find(match => match.bindings['item'] === 'item-0')!
    const claim = scalar.claim!.claim
    if (claim.payload.kind !== 'attribute') throw new Error('expected attribute')
    const corrupted = { ...scalar, claim: { ...scalar.claim!, claim: { ...claim,
      payload: { ...claim.payload, value: { ...claim.payload.value, num: 99 } } } } }
    assert.throws(() => QueryRecord.decode(JSON.stringify(corrupted)), /malformed/)
  } finally { store.close() }
})

test('WASM shape snapshots preserve gated rollback and caller transactions', () => {
  const store = openWith(adapter)
  try {
    store.ingest('service EXPECTS owner\napi IS service\napi HAS owner: platform')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(evaluate(store).violations.length, 0)
    assert.equal(check(store).coverage.instances, 1)
    assert.equal(gatedIngest(store, 'worker IS service').ok, false)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    const rollback = new Error('caller rollback')
    assert.throws(() => store.transaction(() => {
      store.ingest('worker IS service\nworker HAS owner: platform')
      assert.equal(check(store).coverage.instances, 2)
      assert.equal(evaluate(store).violations.length, 0)
      throw rollback
    }), error => error === rollback)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    store.ingest('service EXPECTS owner #cardinality:many')
    assert.throws(() => check(store), /invalid shape declaration/)
    assert.throws(() => evaluate(store), /invalid shape declaration/)
    store.ingest('recovered IS state')
  } finally { store.close() }
})

test('WASM database paths cannot imply unsupported persistence', () => {
  for (const path of ['', 'knowledge.db', '/tmp/knowledge.db', 'file:knowledge.db', 'file::memory:']) {
    assert.throws(() => openWith(adapter, path), /supports only :memory: databases/)
  }
  const first = openWith(adapter)
  try { first.ingest('api IS healthy') } finally { first.close() }
  const second = openWith(adapter, ':memory:')
  try { assert.equal(second.currentBeliefs().length, 0, 'separate memory opens never imply persistence') }
  finally { second.close() }
})

test('WASM statements release native allocations after calls and remain reusable after failure', t => {
  let allocated = 0
  let freed = 0
  const prepare = sqlite.Database.prototype.prepare
  t.mock.method(sqlite.Database.prototype, 'prepare', function (this: initSqlJs.Database, ...args: Parameters<typeof prepare>) {
    const statement = prepare.apply(this, args)
    allocated++
    const free = statement.free
    statement.free = () => { freed++; return free.call(statement) }
    return statement
  })
  const database = adapter.open(':memory:')
  try {
    const query = database.prepare('SELECT ? AS value')
    assert.equal(query.get('first')?.value, 'first')
    assert.equal(allocated, freed)
    assert.deepEqual(query.all('second'), [Object.assign(Object.create(null), { value: 'second' })])
    assert.equal(allocated, freed)
    assert.throws(() => query.get(9007199254740992n), /safe range/)
    assert.equal(allocated, freed)
    assert.equal(query.get('recovered')?.value, 'recovered')
    database.exec('CREATE TABLE checked (value INTEGER CHECK(value > 0))')
    const insert = database.prepare('INSERT INTO checked VALUES (?)')
    assert.throws(() => insert.run(-1), /CHECK constraint failed/)
    assert.equal(allocated, freed)
    assert.equal(insert.run(1).changes, 1)
    assert.equal(allocated, freed)
  } finally { database.close() }
})

for (const method of ['all', 'get', 'run'] as const) for (const readFails of [false, true]) {
  test(`WASM ${method} retains statement cleanup errors (read failure=${readFails})`, t => {
    const readError = new Error('statement read interrupted'), freeError = new Error('statement release interrupted')
    let active = true, frees = 0
    const prepare = sqlite.Database.prototype.prepare
    t.mock.method(sqlite.Database.prototype, 'prepare', function (this: initSqlJs.Database, ...args: Parameters<typeof prepare>) {
      const statement = prepare.apply(this, args)
      if (args[0] === 'SELECT 1 AS value') {
        const step = statement.step, free = statement.free
        statement.step = () => {
          if (active && readFails) throw readError
          return step.call(statement)
        }
        statement.free = () => {
          frees++
          const result = free.call(statement)
          if (active) throw freeError
          return result
        }
      }
      return statement
    })
    const db = adapter.open(':memory:')
    try {
      const statement = db.prepare('SELECT 1 AS value')
      assert.throws(() => statement[method](), error => {
        if (!readFails) return error === freeError
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [readError, freeError])
        assert.equal(error.cause, readError)
        assert.ok(error.message.includes(readError.message))
        assert.ok(error.message.includes(freeError.message))
        return true
      })
      assert.equal(frees, 1)
      active = false
      assert.doesNotThrow(() => statement[method]())
      assert.equal(frees, 2)
    } finally { db.close() }
  })
}

test('WASM statement aggregates preserve unprintable execution failures', t => {
  const failure = Object.create(null), cleanupError = new Error('release interrupted')
  const prepare = sqlite.Database.prototype.prepare
  t.mock.method(sqlite.Database.prototype, 'prepare', function (this: initSqlJs.Database, ...args: Parameters<typeof prepare>) {
    const statement = prepare.apply(this, args)
    const free = statement.free
    statement.step = () => { throw failure }
    statement.free = () => { free.call(statement); throw cleanupError }
    return statement
  })
  const db = adapter.open(':memory:')
  try {
    assert.throws(() => db.prepare('SELECT 1').get(), error => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.cause, failure)
      assert.equal(error.errors[0], failure)
      assert.equal(error.errors[1], cleanupError)
      assert.ok(error.message.includes('[unprintable thrown value]'))
      assert.ok(error.message.includes(cleanupError.message))
      return true
    })
  } finally { db.close() }
})

for (const closeFails of [false, true]) {
  test(`playground store startup failures retire the runtime (close failure=${closeFails})`, t => {
    const startupError = new Error('startup pragma interrupted'), closeError = new Error('startup close interrupted')
    const exec = sqlite.Database.prototype.exec, close = sqlite.Database.prototype.close
    let active = true, closes = 0
    t.mock.method(sqlite.Database.prototype, 'exec', function (this: initSqlJs.Database, ...args: Parameters<typeof exec>) {
      if (active && args[0].includes('busy_timeout')) throw startupError
      return exec.apply(this, args)
    })
    t.mock.method(sqlite.Database.prototype, 'close', function (this: initSqlJs.Database) {
      closes++
      close.call(this)
      if (active && closeFails) throw closeError
    })
    assert.throws(() => openPlaygroundDatabase(adapter), error => {
      assert.ok(error instanceof SqliteInitializationError)
      assert.equal(describeWorkerError(error).fatal, true)
      assert.ok(error.message.includes(startupError.message))
      if (closeFails) {
        assert.ok(error.cause instanceof AggregateError)
        assert.equal(error.cause.errors[0], startupError)
        assert.equal(error.cause.errors[1], closeError)
        assert.ok(error.message.includes(closeError.message))
      } else assert.equal(error.cause, startupError)
      return true
    })
    assert.equal(closes, 1)
    active = false
    const retry = openPlaygroundDatabase(adapter)
    try {
      retry.ingest('api IS service')
      assert.equal(query(retry, '?service IS service').length, 1)
    } finally { retry.close() }
    assert.equal(closes, 2)
  })
}

sqliteAdapterContract(adapter, {
  backup: false,
  fullText: 'fts4',
  loadExtension: false,
})

test('runtime selection uses adapter injection, not module replacement', () => {
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { scripts: { test: string } }
  assert.doesNotMatch(vite, /node:sqlite/)
  assert.equal(manifest.scripts.test, 'node --test test/*.test.ts')
})

const family = `
PARENT-OF IS verb
PARENT-OF REVERSE CHILD-OF
helena PARENT-OF jan
jan PARENT-OF maria @src:archive @ 95%
maria PARENT-OF anna
anna PARENT-OF me
`

test('SQLite WASM runs the real CAVE ingest and query path', () => {
  const store = openWith(adapter, ':memory:')
  try {
    const ingested = store.ingest(family, { strict: true, source: 'playground/test' })
    assert.equal(ingested.ids.length, 6)

    const ancestors = query(store, '?ancestor PARENT-OF+ me')
      .map(match => match.bindings['ancestor'])
      .sort()
    assert.deepEqual(ancestors, ['anna', 'helena', 'jan', 'maria'])

    const descendants = query(store, '?descendant CHILD-OF+ helena')
      .map(match => match.bindings['descendant'])
      .sort()
    assert.deepEqual(descendants, ['anna', 'jan', 'maria', 'me'])
  } finally {
    store.close()
  }
})

test('WASM metadata queries handle large lists and preserve NUL suffixes', () => {
  const store = openWith(adapter, ':memory:')
  try {
    const metadata = Array.from({ length: 1500 }, (_, i) => `@scope-${i} #tag-${i}:value`).join(' ')
    assert.deepEqual(store.ingest(`complete IS service ${metadata}\nmissing IS service @scope-0 #tag-0:value`).problems, [])
    assert.deepEqual(query(store, `?x IS service ${metadata}`).map(row => row.bindings['x']), ['complete'])
    assert.equal(query(store, `?x IS service ${metadata} @absent`).length, 0)
    assert.equal(query(store, `?x IS service ${metadata} #tag-1499:wrong`).length, 0)
    assert.deepEqual(store.ingest('nul IS service @scope:\0tail #key\0tail:value\0tail').problems, [])
    for (const size of [1, 16, 17]) {
      const input = '?x IS service' + ' @scope:\0tail #key\0tail:value\0tail'.repeat(size)
      assert.equal(query(store, input).length, 1)
      assert.equal(query(store, input + ' @scope:\0different').length, 0)
      assert.equal(query(store, input + ' #key\0tail:value\0different').length, 0)
    }
  } finally { store.close() }
})

test('WASM grouped WHERE filters preserve comparisons, missing values and metadata', () => {
  const store = openWith(adapter, ':memory:')
  try {
    store.ingest('high HAS score: 42ms @ 80% @scope:\0tail #key\0tail:value\0tail\nlow HAS score: 2ms @ 20%\ntext HAS score: "text" @ 0%\nunitless HAS score: 42')
    const filters = [
      ...['=', '!=', '<', '<=', '>', '>='].flatMap(op => [
        `WHERE conf ${op} 5e-324`, `WHERE value ${op} 42ms`, `WHERE tx ${op} 2020-01-01`,
      ]),
      'WHERE context = scope:\0tail', 'WHERE context = scope:\0different',
      'WHERE tag = key\0tail', 'WHERE tag = key\0tail:value\0tail',
      'WHERE tag = key\0tail:value\0different',
    ]
    for (const filter of filters) {
      const input = '?x HAS score: ?value\n'
      assert.deepEqual(query(store, input + Array.from({ length: 1500 }, () => filter).join('\n'))
        .map(result => result.row!.id), query(store, input + filter).map(result => result.row!.id), filter)
    }
    const input = '?x HAS score: ?value\n' + 'WHERE conf >= 0\n'.repeat(33_000)
    assert.equal(query(store, input).length, 4)
    assert.equal(query(store, input + 'WHERE value > 100ms').length, 0)
  } finally { store.close() }
})

test('WASM resolution materializes large policies without losing the final prefix', () => {
  const store = openWith(adapter, ':memory:')
  try {
    const prefix = "é'archive\0tail"
    const declarations = Array.from({ length: 1000 }, (_, i) => `source/unused-${i} HAS precedence: 1`)
    declarations.push(`source/${prefix} HAS precedence: 7`, `source/${prefix} HAS reliability: 0.5`)
    assert.deepEqual(store.ingest(declarations.join('\n')).problems, [])
    store.ingest(`server IS compromised @ 60% @${SourceSpan.context(prefix + '/child')}\nserver IS NOT compromised @ 90% @src:archive`)
    const winner = query(store, 'server IS compromised', { resolve: true })
    assert.equal(winner.length, 1)
    assert.equal(winner[0]!.row!.conf, 0.6)
    const group = store.contested().find(group => group.rows.some(row => row.subject === 'server'))!
    assert.equal(group.rows[0]!.res_class, 7)
    assert.equal(group.rows[0]!.res_conf, 0.3)
  } finally { store.close() }
})

test('WASM alias resolution keeps unrelated NUL-bearing names distinct', () => {
  for (const position of ['subject', 'object']) {
    const store = openWith(adapter, ':memory:')
    try {
      const first = 'é\0first', second = 'é\0second'
      const fact = (name: string, confidence: number) => position === 'subject'
        ? `${name} USES target @ ${confidence}%` : `owner USES ${name} @ ${confidence}%`
      const input = position === 'subject' ? '?name USES target' : 'owner USES ?name'
      store.ingest(`${fact(first, 60)}\n${fact(second, 70)}`)
      assert.equal(query(store, input, { resolve: true, aliases: true }).length, 2)
      store.ingest(`${first} ALIAS nickname\n${fact('nickname', 90)}`)
      assert.equal(query(store, input, { resolve: true }).length, 3)
      const names = query(store, input, { resolve: true, aliases: true }).map(row => row.bindings['name']).sort()
      assert.deepEqual(names, ['nickname', second].sort())
    } finally { store.close() }
  }
})

test('WASM resolution preserves NUL policy identities and source specificity', () => {
  const store = openWith(adapter, ':memory:')
  try {
    const prefix = "é'archive\0tail"
    store.ingest(`source/${prefix} HAS precedence: 7\nsource/${prefix}/nested HAS precedence: 9`)
    assert.equal(store.resolutionPolicy().find(entry => entry.prefix === prefix)?.precedence, 7)
    for (const [subject, source] of [['exact', prefix], ['child', prefix + '/nested'], ['sibling', prefix + 'suffix']]) {
      store.ingest(`${subject} IS service @ 20% @${SourceSpan.context(source!)}\n${subject} IS NOT service @ 90% @src:agent`)
    }
    const rows = query(store, '?x IS service', { resolve: true })
    assert.deepEqual(rows.map(row => row.bindings['x']), ['exact', 'child'])
    store.ingest('source/review HAS precedence: 9 @ 90% @src:cli\0suffix\nsource/review HAS precedence: 3 @ 10% @src:agent')
    assert.equal(store.resolutionPolicy().find(entry => entry.prefix === 'review')?.precedence, 3)
  } finally { store.close() }
})

test('WASM text binding preserves complete UTF-8 bytes including NUL', () => {
  const db = adapter.open(':memory:')
  try {
    for (const text of ['before\0after', 'é\0東京', '\0start', 'end\0', '\uFEFFheading', '']) {
      const expected = Buffer.from(text).toString('hex').toUpperCase()
      assert.equal(db.prepare('SELECT hex(?) AS bytes').get(text)?.bytes, expected)
    }
  } finally { db.close() }
})

test('WASM get and all decode complete TEXT while preserving other result types', () => {
  const db = adapter.open(':memory:')
  try {
    for (const text of ['before\0after', 'é\0東京', '\0start', 'end\0', '\uFEFFheading', '']) {
      const bytes = new Uint8Array(Buffer.from(text))
      const statement = db.prepare('SELECT CAST(? AS TEXT) AS text, ? AS blob, 42 AS n, NULL AS absent')
      for (const row of [statement.get(bytes, bytes), statement.all(bytes, bytes)[0]]) {
        assert.equal(row?.text, text)
        assert.deepEqual(row?.blob, bytes)
        assert.equal(row?.n, 42)
        assert.equal(row?.absent, null)
      }
    }
  } finally { db.close() }
})


test('WASM bounded pages preserve historical revisions and post-filter continuations', () => {
  const store = openWith(adapter)
  try {
    const ids = store.ingest(Array.from({ length: 125 }, (_, i) =>
      `item/${i} HAS score: 42 @${i < 110 ? '2020..2021' : '2025..2027'}`).join('\n')).ids
    const initial = ids.at(-1)!
    store.ingest('item/120 HAS score: 43 @2025..2027\nitem/121 HAS score: 42 @2025..2027 @ 0%')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const asOf of [initial, undefined]) {
      for (const input of ['?x HAS score: 42', '?x HAS score: ?score']) {
        const options = { asOf, at: '2026' }
        const expected = queryRecords(store, input, options)
        const actual = []
        let cursor: string | undefined
        let snapshot: string | null | undefined
        let pages = 0
        do {
          const result = page(store, input, { ...options, limit: 3, cursor })
          snapshot ??= result.snapshot
          assert.equal(result.snapshot, snapshot)
          actual.push(...result.matches)
          cursor = result.next
          assert.ok(++pages < 130, 'continuations terminate')
        } while (cursor !== undefined)
        assert.deepEqual(actual, expected)
        assert.equal(actual.length, asOf !== undefined ? 15 : input.endsWith('42') ? 13 : 14)
        assert.ok(pages > 1)
      }
    }
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})
