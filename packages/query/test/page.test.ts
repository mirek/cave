import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Uuidv7 } from '@cavelang/core'
import { canonicalizeText, standardRegistry } from '@cavelang/canonical'
import { defaultLimit, maxLimit, page, query } from '@cavelang/query'
import { compile } from '../src/compile.ts'
import * as Pattern from '../src/pattern.ts'

test('empty pages validate query syntax and time options like populated pages', () => {
  const empty = open(), populated = open()
  try {
    populated.ingest('api USES jwt')
    const cases = [
      { input: 'this is not a query', options: {} },
      { input: '?service USES jwt', options: { at: 'not-a-time' } },
      { input: 'node/0 EXTENDS+ ?node', options: { at: '2026-01-01' } },
      { input: '?service PART-OF owner: ?owner', options: {} },
      { input: '?service USES jwt', options: { all: true, resolve: true } },
    ]
    for (const { input, options } of cases) {
      assert.throws(() => page(populated, input, options), /CAVE-Q/, input)
      assert.throws(() => page(empty, input, options), /CAVE-Q/, input)
      assert.throws(() => page(populated, input, { ...options, asOf: '2000-01-01' }), /CAVE-Q/, input)
    }
    assert.deepEqual(page(empty, '?service USES jwt').matches, [])
    assert.equal(page(empty, '?service USES jwt').snapshot, null)
  } finally { empty.close(); populated.close() }
})

test('pages reject historical arrivals and accept a fresh restart', () => {
  const store = open()
  try {
    const older = Uuidv7.next()
    store.ingest('a USES jwt\nb USES jwt')
    const first = page(store, '?x USES jwt', { limit: 1 })
    store.insertResult(canonicalizeText('offline USES jwt', store.registry()), { ids: [older] })
    assert.throws(() => page(store, '?x USES jwt', { limit: 1, cursor: first.next }), /snapshot changed.*restart/i)
    assert.deepEqual(page(store, '?x USES jwt', { limit: 1 }).matches.map(row => row.bindings['x']), ['offline'])
  } finally { store.close() }
})

test('pages reject new lineage touching their boundary but accept wholly future edges', () => {
  const store = open()
  try {
    const original = store.ingest('a USES jwt\nb USES jwt')
    const first = page(store, '?x USES jwt', { limit: 1 })
    store.ingest('future USES jwt\n  BECAUSE review IS complete')
    assert.equal(page(store, '?x USES jwt', { limit: 1, cursor: first.next }).matches[0]!.bindings['x'], 'b')
    const [parent] = store.ingest('later IS decision').ids
    store.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)').run(parent!, 'BECAUSE', original.ids[0]!)
    assert.throws(() => page(store, '?x USES jwt', { limit: 1, cursor: first.next }), /snapshot changed.*restart/i)
  } finally { store.close() }
})

test('a historical write while a page is materialized cannot produce a mixed page', () => {
  for (const scenario of [
    { claims: 'a USES jwt\nb USES jwt', input: '?x USES jwt', offline: 'offline USES jwt', options: {} },
    { claims: 'a HAS score: 42\nb HAS score: 42', input: '?x HAS score: 42', offline: 'offline HAS score: 42', options: {} },
    { claims: 'a USES jwt @2025..2027\nb USES jwt @2025..2027', input: '?x USES jwt', offline: 'offline USES jwt @2025..2027', options: { at: '2026' } },
  ]) {
    const dir = mkdtempSync(join(tmpdir(), 'cave-page-peer-'))
    const store = open(join(dir, 'knowledge.db'))
    store.db.exec('PRAGMA journal_mode = WAL')
    const writer = open(join(dir, 'knowledge.db'))
    try {
      const older = Uuidv7.next()
      store.ingest(scenario.claims)
      let wrote = false
      const intercepted = { ...store, recordOf: (row: Parameters<typeof store.recordOf>[0]) => {
        if (!wrote) {
          wrote = true
          writer.insertResult(canonicalizeText(scenario.offline, writer.registry()), { ids: [older] })
        }
        return store.recordOf(row)
      } }
      assert.throws(() => page(intercepted, scenario.input, { ...scenario.options, limit: 1 }), /snapshot changed.*restart/i)
      assert.equal(wrote, true)
    } finally { writer.close(); store.close(); rmSync(dir, { recursive: true, force: true }) }
  }
})

test('query pages are bounded, ordered, and frozen across concurrent appends', () => {
  const store = open()
  store.ingest(Array.from({ length: 5 }, (_, index) => `service/${index} USES jwt`).join('\n'))
  const first = page(store, '?service USES jwt', { limit: 2 })
  assert.equal(first.format, 'cave.query-page')
  assert.equal(first.version, 1)
  assert.deepEqual(first.matches.map(match => match.bindings['service']), ['service/0', 'service/1'])
  assert.ok(first.next)

  store.ingest('service/later USES jwt')
  const second = page(store, '?service USES jwt', { limit: 2, cursor: first.next })
  const third = page(store, '?service USES jwt', { limit: 2, cursor: second.next })
  assert.deepEqual(
    [...first.matches, ...second.matches, ...third.matches].map(match => match.bindings['service']),
    ['service/0', 'service/1', 'service/2', 'service/3', 'service/4']
  )
  assert.equal(third.next, undefined)
  assert.equal(second.snapshot, first.snapshot)
  assert.equal(query(store, '?service USES jwt').length, 6, 'ordinary library queries remain unbounded')
  store.close()
})

test('direct cursors retain equal-valued claims across later revisions and retractions', () => {
  for (const input of ['?x HAS score: ?score', '?x HAS score: 1']) {
    const store = open()
    try {
      store.ingest('a HAS score: 1\nb HAS score: 1\nc HAS score: 1')
      const expected = query(store, input).map(match => match.row!.id)
      const first = page(store, input, { limit: 1 })
      assert.ok(first.next)
      store.ingest('b HAS score: 1 @ 0%\nc HAS score: 2\nd HAS score: 1')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const second = page(store, input, { limit: 1, cursor: first.next })
      assert.deepEqual(page(store, input, { limit: 1, cursor: first.next }), second)
      assert.ok(second.next)
      const third = page(store, input, { limit: 1, cursor: second.next })
      assert.deepEqual([...first.matches, ...second.matches, ...third.matches].map(match => match.claim!.id), expected)
      assert.equal(third.next, undefined)
      assert.equal(second.snapshot, first.snapshot)
      assert.equal(third.snapshot, first.snapshot)
      const fresh = page(store, input, { limit: 10 })
      assert.deepEqual(fresh.matches.map(match => match.claim!.id), query(store, input).map(match => match.row!.id))
      assert.notEqual(fresh.snapshot, first.snapshot)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  }
})

test('pages capture option values once for both execution and continuation identity', () => {
  const store = open()
  try {
    store.ingest('api HAS score: 1')
    store.ingest('api HAS score: 2')
    store.ingest('api HAS score: 3')
    const expected = query(store, 'api HAS score: ?score', { all: true }).map(row => row.bindings['score'])
    assert.equal(expected.length, 3)
    let reads = 0
    const cases = [
      Object.create({ all: true, limit: 1 }),
      Object.defineProperty({ limit: 1 }, 'all', { value: true }),
      { limit: 1, get all() { return ++reads === 1 } },
    ]
    for (const options of cases) {
      const first = page(store, 'api HAS score: ?score', options)
      assert.ok(first.next)
      const second = page(store, 'api HAS score: ?score', { all: true, limit: 1, cursor: first.next })
      assert.ok(second.next)
      const third = page(store, 'api HAS score: ?score', { all: true, limit: 1, cursor: second.next })
      assert.equal(third.next, undefined)
      assert.deepEqual([...first.matches, ...second.matches, ...third.matches].map(row => row.bindings['score']), expected)
    }
    assert.equal(reads, 1)
  } finally { store.close() }
})

test('query cursors are scoped to the pattern, options, and page size', () => {
  const store = open()
  store.ingest('a USES jwt\nb USES jwt')
  const first = page(store, '?x USES jwt', { limit: 1 })
  assert.throws(() => page(store, '?x USES sessions', { limit: 1, cursor: first.next }), /does not match/)
  assert.throws(() => page(store, '?x USES jwt', { limit: 2, cursor: first.next }), /does not match/)
  assert.throws(() => page(store, '?x USES jwt', { limit: 1, cursor: 'not-a-cursor' }), /invalid pagination cursor/)
  for (const limit of [0, maxLimit + 1, 1.5]) {
    assert.throws(() => page(store, '?x USES jwt', { limit }), new RegExp(`1 to ${maxLimit}`))
  }
  assert.equal(defaultLimit, 100)
  store.close()
})

test('cursor validation rejects obsolete and malformed revision tokens', () => {
  const store = open()
  try {
    store.ingest('a USES jwt\nb USES jwt')
    const first = page(store, '?x USES jwt', { limit: 1 })
    const token = JSON.parse(decodeURIComponent(first.next!))
    for (const changed of [
      { ...token, v: 1 }, { ...token, revision: undefined },
      { ...token, revision: [1, 2, 3] }, { ...token, revision: [1, 2, -1, 4] },
      { ...token, offset: Number.MAX_SAFE_INTEGER + 1 }, { ...token, snapshot: 'not-a-tx' },
      null, true, 0, 'cursor', [], {},
      ...[-1, 0.5, null, '1'].map(offset => ({ ...token, offset })),
      ...[null, {}, '1,2,3,4', [1, 2, 3, 4, 5],
        [1, 2, 3, null], [1, 2, 3, '4'], [1, 2, 3, 0.5],
        [1, 2, 3, Number.MAX_SAFE_INTEGER + 1]].map(revision => ({ ...token, revision })),
      { ...token, fingerprint: null }, { ...token, snapshot: '01980000-0000-7000-8000-00000000000A' },
    ]) {
      assert.throws(() => page(store, '?x USES jwt', {
        limit: 1, cursor: encodeURIComponent(JSON.stringify(changed)),
      }), /invalid pagination cursor.*restart/i)
    }
    for (const cursor of ['%', '%GG', '%C0%AF', '%ED%A0%80', '%7B', 'undefined']) {
      assert.throws(() => page(store, '?x USES jwt', { limit: 1, cursor }),
        /invalid pagination cursor.*restart/i)
    }
    assert.equal(store.currentBeliefs().length, 2)
    const continued = page(store, '?x USES jwt', { limit: 1, cursor: first.next })
    assert.deepEqual(continued.matches.map(match => match.bindings['x']), ['b'])
    assert.equal(continued.next, undefined)
  } finally { store.close() }
})

test('empty pages do not create a continuation that could admit later writes', () => {
  const store = open()
  const empty = page(store, '?x USES jwt', { limit: 1 })
  assert.equal(empty.snapshot, null)
  assert.deepEqual(empty.matches, [])
  assert.equal(empty.next, undefined)
  store.ingest('later USES jwt')
  assert.equal(page(store, '?x USES jwt', { limit: 1 }).matches.length, 1)
  store.close()
})

test('SQL windows reject malformed and unsafe integer bounds before binding them', () => {
  const store = open()
  try {
    store.ingest('api USES jwt')
    for (const value of [null, false, '1', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1e20]) {
      for (const options of [{ limit: value }, { limit: 1, offset: value }]) {
        for (const run of [() => compile(Pattern.parse('?x USES jwt'), standardRegistry, options as never),
          () => query(store, '?x USES jwt', options as never)]) {
          assert.throws(run, /limit must be a positive safe integer and offset must be a non-negative safe integer/)
        }
      }
    }
    assert.equal(query(store, '?x USES jwt', { limit: Number.MAX_SAFE_INTEGER }).length, 1)
    assert.equal(query(store, '?x USES jwt', { limit: 1, offset: Number.MAX_SAFE_INTEGER }).length, 0)
    assert.equal(query(store, '?x USES jwt', { limit: 1, offset: 0 })[0]?.bindings['x'], 'api')
  } finally { store.close() }
})

test('SQL windows carry the requested limit and offset into SQLite', () => {
  const compiled = compile(Pattern.parse('?x USES jwt'), standardRegistry, { limit: 7, offset: 14 })
  assert.match(compiled.sql, /ORDER BY c\.tx\nLIMIT \? OFFSET \?$/)
  assert.deepEqual(compiled.params.slice(-2), [7, 14])
})

test('valid-time pages advance over rejected SQL rows without skipping matches', () => {
  const store = open()
  store.ingest([
    'expired WORKS-AT acme @2020..2021',
    'alice WORKS-AT acme @2025..2027',
    'future WORKS-AT acme @2030..2031',
    'bob WORKS-AT acme @2024..2028'
  ].join('\n'))
  const first = page(store, '?person WORKS-AT acme', { at: '2026', limit: 1 })
  assert.deepEqual(first.matches.map(match => match.bindings['person']), ['alice'])
  assert.ok(first.next)

  store.ingest('later WORKS-AT acme @2026..2029')
  const second = page(store, '?person WORKS-AT acme', { at: '2026', limit: 1, cursor: first.next })
  assert.deepEqual(second.matches.map(match => match.bindings['person']), ['bob'])
  assert.equal(second.next, undefined)
  store.close()
})

test('exact numeric pages skip approximation mismatches without losing normalized equals', () => {
  const store = open()
  store.ingest([
    'estimate/a HAS users: ~900M users/wk',
    'estimate/b HAS users: 0.9B users/wk',
    'estimate/c HAS users: 900M users/wk'
  ].join('\n'))
  const first = page(store, '?estimate HAS users: 900M users/wk', { limit: 1 })
  assert.deepEqual(first.matches.map(match => match.bindings['estimate']), ['estimate/b'])
  const second = page(store, '?estimate HAS users: 900M users/wk', { limit: 1, cursor: first.next })
  assert.deepEqual(second.matches.map(match => match.bindings['estimate']), ['estimate/c'])
  assert.equal(second.next, undefined)
  store.close()
})

test('aliased transitive pages deduplicate physical endpoint spellings in SQL', () => {
  const store = open()
  store.ingest([
    'dog ALIAS doggo',
    'dog EXTENDS mammal',
    'doggo EXTENDS mammal',
    'mammal EXTENDS animal'
  ].join('\n'))
  const first = page(store, 'dog EXTENDS+ ?ancestor', { aliases: true, limit: 1 })
  const second = page(store, 'dog EXTENDS+ ?ancestor', {
    aliases: true, limit: 1, cursor: first.next
  })
  assert.deepEqual(
    [...first.matches, ...second.matches].map(match => match.bindings['ancestor']),
    ['animal', 'mammal']
  )
  assert.equal(second.next, undefined)
  store.close()
})

test('post-filter scans yield a continuation when their bounded budget finds no match', () => {
  const store = open()
  store.ingest([
    ...Array.from({ length: defaultLimit }, (_, index) =>
      `expired/${index} WORKS-AT acme @2020..2021`),
    'current WORKS-AT acme @2025..2027'
  ].join('\n'))
  const first = page(store, '?person WORKS-AT acme', { at: '2026', limit: 1 })
  assert.deepEqual(first.matches, [])
  assert.ok(first.next)
  const second = page(store, '?person WORKS-AT acme', { at: '2026', limit: 1, cursor: first.next })
  assert.deepEqual(second.matches.map(match => match.bindings['person']), ['current'])
  assert.equal(second.next, undefined)
  store.close()
})

test('post-filter pages batch SQL reads without skipping unconsumed matches', () => {
  const store = open()
  try {
    store.ingest(Array.from({ length: 120 }, (_, i) =>
      `person/${i} HAS score: 42 @${i % 3 === 0 ? '2020..2021' : '2025..2027'}`).join('\n'))
    let reads = 0
    const measured = { ...store, db: { ...store.db, exec: store.db.exec.bind(store.db), prepare: (sql: string) => {
      if (/LIMIT \? OFFSET \?/.test(sql)) reads++
      return store.db.prepare(sql)
    } } }
    const numeric = page(measured, '?person HAS score: 42', { limit: 100 })
    assert.equal(numeric.matches.length, 100)
    assert.ok(reads <= 2, `expected a batch and lookahead, got ${reads} SQL windows`)
    const rest = page(measured, '?person HAS score: 42', { limit: 100, cursor: numeric.next })
    assert.deepEqual([...numeric.matches, ...rest.matches].map(match => match.bindings['person']),
      Array.from({ length: 120 }, (_, i) => `person/${i}`))
    assert.equal(rest.next, undefined)
    const found: string[] = []
    let cursor: string | undefined
    do {
      const result = page(store, '?person HAS score: ?score', { at: '2026', limit: 17, cursor })
      assert.ok(result.matches.length <= 17)
      found.push(...result.matches.map(match => match.bindings['person']!))
      cursor = result.next
    } while (cursor !== undefined)
    assert.deepEqual(found, Array.from({ length: 120 }, (_, i) => i)
      .filter(i => i % 3 !== 0).map(i => `person/${i}`))
  } finally { store.close() }
})

test('selective one-result pages read one candidate batch and retain the raw continuation', () => {
  const store = open()
  try {
    store.ingest(Array.from({ length: 201 }, (_, i) =>
      `person/${i} HAS score: 42 @${i === 99 || i === 100 || i === 200 ? '2025..2027' : '2020..2021'}`).join('\n'))
    let reads = 0
    const measured = { ...store, db: { ...store.db, exec: store.db.exec.bind(store.db), prepare: (sql: string) => {
      if (/LIMIT \? OFFSET \?/.test(sql)) reads++
      return store.db.prepare(sql)
    } } }
    const first = page(measured, '?person HAS score: ?score', { at: '2026', limit: 1 })
    assert.deepEqual(first.matches.map(match => match.bindings['person']), ['person/99'])
    assert.ok(reads <= 2, `expected a batch and lookahead, got ${reads} SQL windows`)
    const second = page(measured, '?person HAS score: ?score', { at: '2026', limit: 1, cursor: first.next })
    assert.deepEqual(second.matches.map(match => match.bindings['person']), ['person/100'])
    const third = page(measured, '?person HAS score: ?score', { at: '2026', limit: 1, cursor: second.next })
    assert.deepEqual(third.matches.map(match => match.bindings['person']), ['person/200'])
    assert.equal(third.next, undefined)
  } finally { store.close() }
})

test('pre-epoch transaction boundaries are empty while crossing periods retain epoch claims', () => {
  const store = open()
  try {
    const ids = [0, 1000].map(ms => Uuidv7.at(ms, 0, new Uint8Array(8)))
    store.insertResult(canonicalizeText('epoch USES jwt @1960\nlater USES jwt @1980', store.registry()), { ids })
    for (const asOf of ['0000', '1969', '1969-12-31T23:59:58Z']) {
      assert.deepEqual(query(store, '?x USES jwt', { asOf }), [])
      assert.equal(page(store, '?x USES jwt', { asOf }).snapshot, null)
    }
    for (const [op, count] of [['=', 0], ['<', 0], ['<=', 0], ['>', 2], ['>=', 2], ['!=', 2]] as const) {
      assert.equal(query(store, `?x USES jwt\n  WHERE tx ${op} 1969-12-31`).length, count)
    }
    const asOf = '1969-12-31T23:59:59.500Z'
    assert.deepEqual(query(store, '?x USES jwt', { asOf }).map(match => match.bindings['x']), ['epoch'])
    assert.equal(page(store, '?x USES jwt', { asOf }).snapshot, ids[0])
    assert.deepEqual(query(store, '?x USES jwt', { at: '1960' }).map(match => match.bindings['x']), ['epoch'])
  } finally { store.close() }
})

for (const numeric of [false, true]) {
  test(`page metadata stays with selected rows through peer updates (numeric=${numeric})`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-page-metadata-'))
    const writer = open(join(dir, 'knowledge.db'))
    writer.db.exec('PRAGMA journal_mode = WAL')
    writer.ingest('api HAS score: 42 @2025..2027 @src:manual #phase:before')
    const reader = open(join(dir, 'knowledge.db'), { access: 'read-only' })
    const input = numeric ? 'api HAS score: 42' : 'api HAS score: ?score'
    const options = numeric ? { limit: 1 } : { limit: 1, at: '2026' }
    try {
      const before = page(reader, input, options)
      assert.equal(before.matches.length, 1)
      const recordOf = reader.recordOf.bind(reader)
      let changed = false
      t.mock.method(reader, 'recordOf', (row: Parameters<typeof recordOf>[0]) => {
        if (!changed) {
          changed = true
          writer.db.exec("BEGIN; UPDATE cave_tag SET value = 'after' WHERE key = 'phase'; UPDATE cave_provenance SET value = 'updated-source' WHERE dimension = 'source'; COMMIT")
        }
        return recordOf(row)
      })
      assert.deepEqual(page(reader, input, options), before)
      assert.equal(changed, true)
      const after = page(reader, input, options)
      assert.notDeepEqual(after, before)
      assert.deepEqual(after, page(writer, input, options))
    } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}

for (const numeric of [false, true]) for (const cleanupFails of [false, true]) {
  test(`page projection failure preserves caller ownership (numeric=${numeric}, cleanup=${cleanupFails})`, t => {
    const store = open()
    const failure = Object.create(null)
    const cleanup = new Error('snapshot release failed')
    const rollback = new Error('rollback caller transaction')
    const input = numeric ? 'api HAS score: 42' : 'api HAS score: ?score'
    const options = numeric ? { limit: 1 } : { limit: 1, at: '2026' }
    try {
      assert.throws(() => store.transaction(() => {
        store.ingest('api HAS score: 42 @2025..2027')
        assert.equal(page(store, input, options).matches.length, 1)
        let failed = false, releases = 0
        const projection = t.mock.method(store, 'recordOf', () => { failed = true; throw failure })
        const exec = store.db.exec.bind(store.db)
        const release = t.mock.method(store.db, 'exec', (sql: string) => {
          exec(sql)
          if (failed && sql === 'RELEASE cave_query_read') {
            releases++
            if (cleanupFails) throw cleanup
          }
        })
        try {
          assert.throws(() => page(store, input, options), error => {
            if (!cleanupFails) return error === failure
            assert.ok(error instanceof AggregateError)
            assert.equal(error.cause, failure)
            assert.deepEqual(error.errors, [failure, cleanup])
            assert.match(error.message, /unprintable thrown value/)
            return true
          })
          assert.equal(releases, 1)
        } finally { projection.mock.restore(); release.mock.restore() }
        assert.equal(page(store, input, options).matches.length, 1)
        throw rollback
      }), error => error === rollback)
      assert.equal(page(store, input, options).matches.length, 0)
      store.ingest('api HAS score: 42 @2025..2027')
      assert.equal(page(store, input, options).matches.length, 1)
    } finally { store.close() }
  })
}


test('null page limits reject on first and continuation requests without consuming the cursor', () => {
  const store = open()
  try {
    for (const seeded of [false, true]) {
      if (seeded) store.ingest('api USES jwt\nauth USES jwt')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const first = page(store, '?x USES jwt', { limit: 1 })
      for (const cursor of [undefined, ...first.next === undefined ? [] : [first.next]]) {
        let reads = 0
        assert.throws(() => page(store, '?x USES jwt', {
          cursor,
          get limit() { reads += 1; return null }
        } as never), /page limit must be an integer/)
        assert.equal(reads, 1)
      }
      if (first.next !== undefined) {
        const next = page(store, '?x USES jwt', { limit: 1, cursor: first.next })
        assert.equal(next.matches.length, 1)
        assert.notDeepEqual(next.matches, first.matches)
      }
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
  } finally { store.close() }
})


for (const transitive of [false, true]) test(`frozen ${transitive ? 'transitive' : 'direct'} pages retain aliases after a peer retracts them`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-page-alias-history-'))
  const path = join(dir, 'knowledge.db')
  const writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  const reader = open(path, { access: 'read-only' })
  try {
    const verb = transitive ? 'EXTENDS' : 'USES'
    writer.ingest(`a ${verb} postgres\nb ${verb} postgresql\npostgres ALIAS postgresql`)
    const input = `?x ${verb}${transitive ? '+' : ''} postgres`
    const expected = page(reader, input, { aliases: true }).matches
    assert.deepEqual(expected.map(row => row.bindings['x']), ['a', 'b'])
    const first = page(reader, input, { aliases: true, limit: 1 })
    assert.ok(first.next)
    writer.ingest(`postgres ALIAS postgresql @ 0%\nfuture ${verb} postgres`)
    const before = writer.exportText({ tx: true, maxSensitivity: 'restricted' })
    const next = page(reader, input, { aliases: true, limit: 1, cursor: first.next })
    assert.equal(next.snapshot, first.snapshot)
    assert.equal(next.next, undefined)
    assert.deepEqual([...first.matches, ...next.matches], expected)
    assert.deepEqual(page(reader, input, { aliases: true }).matches.map(row => row.bindings['x']), ['a', 'future'])
    assert.deepEqual(page(reader, input, { aliases: true, asOf: first.snapshot! }).matches, expected)
    assert.equal(writer.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})


test('bounded direct selection agrees with unbounded history after revisions and retractions', () => {
  const store = open()
  try {
    const first = store.ingest('a HAS score: 1\nb HAS score: 2\nc HAS score: 3').ids.at(-1)!
    store.ingest('a HAS score: 4\nb HAS score: 2 @ 0%\nc HAS score: 5')
    const revised = store.currentBeliefs().at(-1)!.tx
    store.ingest('b HAS score: 6\na HAS score: 4 @ 0%')
    for (const asOf of [first, revised, undefined]) {
      for (const input of ['?x HAS score: ?score', '?x HAS score: ?score\nWHERE value > 2', '?x HAS score: ?score\nWHERE conf = 0']) {
        const expected = query(store, input, { asOf })
        const actual = Array.from({ length: expected.length + 1 }, (_, offset) =>
          query(store, input, { asOf, limit: 1, offset })).flat()
        assert.deepEqual(actual, expected, `${input} at ${asOf}`)
      }
    }
  } finally { store.close() }
})
