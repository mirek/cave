import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as assert from 'node:assert/strict'
import { open, type Store } from '@cavelang/store'
import { check, evaluate, expectations, gatedIngest, generateClient } from '@cavelang/shape'

test('unit violations retain sorted distinct diagnostics across later evaluations', () => {
  const store = open()
  try {
    store.ingest('service EXPECTS latency #unit:ms\napi IS service\napi HAS latency: 2 s @a\napi HAS latency: 3 ms @b\napi HAS latency: 4 @c')
    const first = evaluate(store)
    assert.equal(first.checks, 1)
    assert.equal(first.violations[0]!.actualCount, 3)
    assert.deepEqual(first.violations[0]!.actualUnits, [null, 'ms', 's'])
    store.ingest('api HAS latency: 2 ms @a\napi HAS latency: 4 ms @c')
    assert.equal(evaluate(store).violations.length, 0)
    assert.deepEqual(first.violations[0]!.actualUnits, [null, 'ms', 's'])
  } finally { store.close() }
})

test('expectation listing keeps qualifier edges with their declaration snapshot', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declaration-snapshot-'))
  const path = join(dir, 'knowledge.db')
  const writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  const initial = writer.ingest('proof IS record\nservice EXPECTS owner')
  const reader = open(path, { access: 'read-only' })
  try {
    const expected = expectations(reader)
    const prepare = reader.db.prepare.bind(reader.db)
    let injected = false
    t.mock.method(reader.db, 'prepare', (sql: string) => {
      const statement = prepare(sql)
      if (sql.includes("WHERE verb = 'EXPECTS'")) {
        const all = statement.all.bind(statement)
        t.mock.method(statement, 'all', (...params: (string | number)[]) => {
          const rows = all(...params)
          if (!injected) {
            injected = true
            writer.transaction(() => {
              writer.ingest('service EXPECTS owner #cardinality:one')
              writer.appendEdges([{ parentId: initial.ids[0]!, childId: initial.ids[1]!, role: 'BECAUSE' }])
            })
          }
          return rows
        })
      }
      return statement
    })
    assert.deepEqual(expectations(reader), expected)
    assert.equal(injected, true)
    assert.deepEqual(expectations(reader).map(row => row.cardinality), ['one'])
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('standalone evaluation keeps declarations and facts in one read snapshot', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-evaluation-snapshot-'))
  const path = join(dir, 'knowledge.db')
  const writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('service EXPECTS owner')
  const reader = open(path, { access: 'read-only' })
  try {
    const expected = evaluate(reader)
    const prepare = reader.db.prepare.bind(reader.db)
    let injected = false
    t.mock.method(reader.db, 'prepare', (sql: string) => {
      const statement = prepare(sql)
      if (sql.includes("WHERE verb = 'EXPECTS'")) {
        const all = statement.all.bind(statement)
        t.mock.method(statement, 'all', (...params: (string | number)[]) => {
          const rows = all(...params)
          if (!injected) {
            injected = true
            writer.ingest('service EXPECTS owner @ 0%\nworker IS service')
          }
          return rows
        })
      }
      return statement
    })
    assert.deepEqual(evaluate(reader), expected)
    assert.equal(injected, true)
    assert.deepEqual(evaluate(reader), { expectations: [], violations: [], instances: 0, checks: 0 })
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('health reports retain one read snapshot while another connection writes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-health-snapshot-'))
  const path = join(dir, 'knowledge.db')
  const writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('service EXPECTS owner\napi IS service\napi HAS owner: platform')
  const reader = open(path, { access: 'read-only' })
  try {
    const expected = check(reader)
    const prepare = reader.db.prepare.bind(reader.db)
    let injected = false
    t.mock.method(reader.db, 'prepare', (sql: string) => {
      const statement = prepare(sql)
      if (sql.startsWith('SELECT c.subject, c.verb')) {
        const all = statement.all.bind(statement)
        t.mock.method(statement, 'all', (...params: (string | number)[]) => {
          const rows = all(...params)
          if (!injected) {
            injected = true
            writer.ingest('worker IS service')
          }
          return rows
        })
      }
      return statement
    })
    assert.deepEqual(check(reader), expected)
    assert.equal(injected, true)
    const next = check(reader)
    assert.equal(next.coverage.instances, 2)
    assert.equal(next.violations.length, 1)
    assert.equal(next.violations[0]!.entity, 'worker')
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('health snapshots release after errors and preserve caller transactions', () => {
  const store = open()
  try {
    store.ingest('service EXPECTS owner #cardinality:many')
    assert.throws(() => check(store), /invalid shape declaration/)
    store.ingest('service EXPECTS owner #cardinality:many @ 0%')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const rollback = new Error('caller rollback')
    assert.throws(() => store.transaction(() => {
      store.ingest('api IS service')
      assert.equal(check(store).coverage.typedEntities, 1)
      throw rollback
    }), error => error === rollback)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(check(store).coverage.typedEntities, 0)
  } finally { store.close() }
})

test('entity coverage deduplicates actor series and excludes literals and verb tokens', () => {
  const store = open()
  try {
    store.ingest('api IS service @src:first\napi IS service @src:second\napi IS NOT retired\n"quoted subject" IS service\napi USES "quoted object"\nMIGRATES IS verb\ngone IS old\ngone IS old @ 0%')
    const coverage = check(store).coverage
    assert.equal(coverage.entities, 4, 'api, service, retired, and verb')
    assert.equal(coverage.typedEntities, 1, 'api is typed once across actor series')
  } finally { store.close() }
})

test('coverage aggregates current versions with low-confidence and negative beliefs', () => {
  const store = open()
  try {
    store.ingest('a IS service @ 20%\nb IS NOT service @ 10%\nc IS service\nc IS service @ 0%\nd IS service @ 60%\nd IS service @ 80%')
    const coverage = check(store).coverage
    assert.equal(coverage.rows, 6)
    assert.equal(coverage.facts, 4)
    assert.equal(coverage.current, 2)
    assert.equal(coverage.retracted, 1)
    assert.equal(coverage.negated, 1)
    assert.equal(coverage.lowConfidence, 2)
    assert.ok(Math.abs(coverage.averageConfidence! - 1.1 / 3) < 1e-12)
  } finally { store.close() }
})

test('shape fact snapshots omit unrelated value slots', t => {
  const store = open()
  try {
    store.ingest('service EXPECTS owner\nbackend EXTENDS service\napi IS backend\napi HAS owner: platform')
    const expected = evaluate(store)
    store.ingest(Array.from({ length: 1000 }, (_, i) => `noise/${i} HAS unrelated: value\nnoise/${i} USES dependency`).join('\n'))
    const prepare = store.db.prepare.bind(store.db)
    let factRows = 0
    t.mock.method(store.db, 'prepare', (sql: string) => {
      const statement = prepare(sql)
      if (sql.startsWith('SELECT c.subject, c.verb')) {
        const all = statement.all.bind(statement)
        t.mock.method(statement, 'all', (...params: (string | number)[]) => {
          const rows = all(...params)
          factRows += rows.length
          return rows
        })
      }
      return statement
    })
    assert.deepEqual(evaluate(store), expected)
    assert.equal(factRows, 3, 'typing, taxonomy, and the expected owner slot only')
  } finally { store.close() }
})

test('disabled expectations avoid fact snapshots and reactivation is observed', t => {
  const store = open()
  try {
    store.ingest('service EXPECTS owner\nservice EXPECTS owner @ 0%\napi IS service')
    const prepare = store.db.prepare.bind(store.db)
    let factReads = 0
    t.mock.method(store.db, 'prepare', (sql: string) => {
      if (sql.startsWith('SELECT c.subject, c.verb')) factReads += 1
      return prepare(sql)
    })
    assert.deepEqual(evaluate(store), { expectations: [], violations: [], instances: 0, checks: 0 })
    assert.equal(factReads, 0)
    store.ingest('service EXPECTS owner')
    assert.equal(evaluate(store).violations.length, 1)
    assert.equal(factReads, 1)
    store.ingest('service EXPECTS owner @ 0%')
    assert.equal(evaluate(store).checks, 0)
    assert.equal(factReads, 1, 'disabled declarations do not reuse or rebuild a fact snapshot')
  } finally { store.close() }
})

test('shape side tables retain qualifier exclusions and ignore unrelated constraint tags', () => {
  const store = open()
  try {
    store.ingest([
      'service EXPECTS latency #unit:ms',
      'api IS service',
      '  BECAUSE service EXPECTS owner #cardinality:many',
      'api HAS latency: 10ms #cardinality:many'
    ].join('\n'), { strict: true })
    const result = evaluate(store)
    assert.deepEqual(result.expectations.map(item => item.name), ['latency'])
    assert.equal(result.checks, 1)
    assert.equal(result.violations.length, 0)
  } finally { store.close() }
})

test('empty-shape evaluation observes declarations added after an earlier check', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    assert.deepEqual(evaluate(store), { expectations: [], violations: [], instances: 0, checks: 0 })
    store.ingest('service EXPECTS owner @ 80% ; ownership requirement')
    assert.equal(evaluate(store).violations.length, 1)
    assert.deepEqual(evaluate(store).expectations[0]!.row,
      store.currentBeliefs().find(row => row.verb === 'EXPECTS'), 'complete declaration provenance remains available')
    store.ingest('api HAS owner: team')
    assert.equal(evaluate(store).violations.length, 0)
    store.ingest('service EXPECTS owner @ 0%')
    assert.deepEqual(evaluate(store), { expectations: [], violations: [], instances: 0, checks: 0 })
  } finally { store.close() }
})

test('runtime shape evaluation rejects malformed constraints instead of weakening them', () => {
  for (const declaration of [
    'service EXPECTS owner #cardinality:many',
    'service EXPECTS owner #cardinality:one #cardinality:some',
    'service EXPECTS owner #unit',
    'service EXPECTS USES #unit:ms'
  ]) {
    const store = open()
    try {
      store.ingest(`${declaration}\napi IS service\napi HAS owner: team\napi USES database`)
      assert.throws(() => evaluate(store), /invalid shape declaration/, declaration)
      assert.throws(() => expectations(store), /invalid shape declaration/, declaration)
      assert.throws(() => check(store), /invalid shape declaration/, declaration)
    } finally { store.close() }
  }
})

test('binary stored unit constraints reject checks and generation, then recover after repair', () => {
  const store = open()
  try {
    store.ingest('service EXPECTS cost #unit:USD\napi IS service\napi HAS cost: 1 USD')
    const id = expectations(store)[0]!.row.id
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const value of [new Uint8Array(), new Uint8Array([85, 83, 68])]) {
      store.db.prepare("UPDATE cave_tag SET value = ? WHERE claim_id = ? AND key = 'unit'").run(value, id)
      for (const read of [expectations, evaluate, check]) {
        assert.throws(() => read(store), /invalid shape declaration.*unit must have one non-empty text value/)
      }
      const client = generateClient(store)
      assert.equal(client.ok, false)
      if (!client.ok) assert.match(client.problems.join('; '), /unit must have one non-empty text value/)
      assert.throws(() => gatedIngest(store, 'other IS unrelated'), /invalid shape declaration/)
      assert.deepEqual(store.db.prepare("SELECT value FROM cave_tag WHERE claim_id = ? AND key = 'unit'").get(id)!.value, value)
      store.db.prepare("UPDATE cave_tag SET value = 'USD' WHERE claim_id = ? AND key = 'unit'").run(id)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.equal(evaluate(store).violations.length, 0)
      assert.equal(generateClient(store).ok, true)
    }
  } finally { store.close() }
})

const evaluationQueryCount = (store: Store): { readonly queries: number, readonly checks: number } => {
  const database = store.db
  let queries = 0
  const counted: Store = {
    ...store,
    db: {
      exec: sql => database.exec(sql),
      prepare: sql => {
        queries += 1
        return database.prepare(sql)
      },
      close: () => database.close()
    }
  }
  const checks = evaluate(counted).checks
  return { queries, checks }
}

test('EXPECTS declarations read back as expectations (spec §20.1)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS owner',
    'service EXPECTS USES',
    'team EXPECTS PART-OF'
  ].join('\n'))
  const declared = expectations(store)
  assert.deepEqual(
    declared.map(({ type, kind, name }) => ({ type, kind, name })),
    [
      { type: 'service', kind: 'attribute', name: 'owner' },
      { type: 'service', kind: 'relation', name: 'USES' },
      { type: 'team', kind: 'relation', name: 'PART-OF' }
    ]
  )
  store.close()
})

test('EXPECTS reads optional cardinality and unit constraints from scoped tags (spec §20.1)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS owner #cardinality:one',
    'service EXPECTS latency #unit:ms',
    'service EXPECTS USES'
  ].join('\n'))
  assert.deepEqual(
    expectations(store).map(({ type, kind, name, cardinality, unit }) =>
      ({ type, kind, name, cardinality, unit })),
    [
      { type: 'service', kind: 'attribute', name: 'owner', cardinality: 'one', unit: undefined },
      { type: 'service', kind: 'attribute', name: 'latency', cardinality: 'some', unit: 'ms' },
      { type: 'service', kind: 'relation', name: 'USES', cardinality: 'some', unit: undefined }
    ]
  )
  store.close()
})

test('retracting an expectation stops it checking (spec §20.1)', () => {
  const store = open()
  store.ingest('service EXPECTS owner\napi IS service')
  assert.equal(evaluate(store).violations.length, 1)
  store.ingest('service EXPECTS owner @ 0% ; too strict for now')
  assert.equal(evaluate(store).violations.length, 0)
  assert.equal(expectations(store).length, 0)
  store.close()
})

test('negated expectations never check (spec §20.1)', () => {
  const store = open()
  store.ingest('service EXPECTS NOT owner\napi IS service')
  assert.equal(evaluate(store).violations.length, 0)
  store.close()
})

test('targets bind through the EXTENDS taxonomy (spec §20.1)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS owner',
    'microservice EXTENDS service',
    'api-gateway IS microservice',
    'billing IS service',
    'microservice HAS style: small ; the subclass itself is not an instance'
  ].join('\n'))
  const { violations, instances, checks } = evaluate(store)
  assert.deepEqual(
    violations.map(({ entity, via }) => ({ entity, via })).sort((a, b) => a.entity.localeCompare(b.entity)),
    [
      { entity: 'api-gateway', via: 'microservice' },
      { entity: 'billing', via: 'service' }
    ]
  )
  assert.equal(instances, 2)
  assert.equal(checks, 2)
  store.close()
})

test('taxonomy binding reaches deep descendants and terminates through cycles', () => {
  const store = open()
  try {
    store.ingest([
      'type-0 EXPECTS owner',
      ...Array.from({ length: 80 }, (_, index) => `type-${index + 1} EXTENDS type-${index}`),
      'type-20 EXTENDS type-80',
      'api IS type-80',
      'api IS type-79'
    ].join('\n'))
    const result = evaluate(store)
    assert.equal(result.instances, 1, 'multiple taxonomy paths check the instance once')
    assert.equal(result.checks, 1)
    assert.deepEqual(result.violations.map(({ entity, via }) => ({ entity, via })),
      [{ entity: 'api', via: 'type-80' }])
    store.ingest('api HAS owner: platform')
    assert.equal(evaluate(store).violations.length, 0)
  } finally { store.close() }
})

test('attribute expectations are satisfied by current positive HAS claims (spec §20.1)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS owner',
    'api IS service',
    'api HAS owner: platform-team'
  ].join('\n'))
  assert.equal(evaluate(store).violations.length, 0)
  store.ingest('api HAS owner: platform-team @ 0% ; team dissolved')
  assert.equal(evaluate(store).violations.length, 1, 'retraction re-opens the violation')
  store.close()
})

test('cardinality one requires exactly one current value while legacy expectations allow many (spec §20.1)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS USES #cardinality:one',
    'service EXPECTS NEEDS',
    'api IS service',
    'api USES postgres',
    'api USES redis',
    'api NEEDS network',
    'api NEEDS compute'
  ].join('\n'))
  const { violations, checks } = evaluate(store)
  assert.equal(checks, 2)
  assert.equal(violations.length, 1)
  assert.equal(violations[0]!.expectation.name, 'USES')
  assert.equal(violations[0]!.actualCount, 2)
  store.ingest('api USES redis @ 0% ; dependency retired')
  assert.equal(evaluate(store).violations.length, 0)
  store.close()
})

test('unit constraints require every current attribute value to use the exact normalized unit (spec §20.1)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS latency #unit:ms',
    'api IS service',
    'api HAS latency: 1s'
  ].join('\n'))
  const violation = evaluate(store).violations[0]!
  assert.equal(violation.expectation.unit, 'ms')
  assert.equal(violation.actualCount, 1)
  assert.deepEqual(violation.actualUnits, ['s'])
  store.ingest('api HAS latency: 20ms ; corrected to the required unit')
  assert.equal(evaluate(store).violations.length, 0)
  store.close()
})

test('a missing constrained value stays one failed shape check with observed details (spec §20.2)', () => {
  const store = open()
  store.ingest('service EXPECTS latency #cardinality:one #unit:ms\napi IS service')
  const { violations, checks } = evaluate(store)
  assert.equal(checks, 1)
  assert.equal(violations.length, 1)
  assert.equal(violations[0]!.actualCount, 0)
  assert.deepEqual(violations[0]!.actualUnits, [])
  store.close()
})

test('relation expectations follow the verb direction, inverses included (spec §20.1)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS USES',
    'team EXPECTS PART-OF',
    'api IS service',
    'checkout IS team'
  ].join('\n'))
  assert.equal(evaluate(store).violations.length, 2)
  store.ingest('api USES postgres')
  assert.equal(evaluate(store).violations.length, 1)
  store.ingest('org/payments CONTAINS checkout ; satisfies PART-OF via the stored primary row')
  assert.equal(evaluate(store).violations.length, 0)
  store.close()
})

test('selective observed indexes retain mixed attributes, directions and taxonomy relations', () => {
  const store = open()
  try {
    store.ingest([
      ...['owner', 'IS', 'EXTENDS', 'USES', 'CONTAINS', 'PART-OF'].map(name => `service EXPECTS ${name}`),
      'api IS service', 'api EXTENDS base', 'api USES postgres', 'org CONTAINS api',
      'api CONTAINS child', 'api HAS owner: team'
    ].join('\n'))
    const first = evaluate(store)
    assert.equal(first.checks, 6)
    assert.equal(first.violations.length, 0)
    store.ingest('api CONTAINS child @ 0%')
    const second = evaluate(store)
    assert.equal(second.checks, 6)
    assert.deepEqual(second.violations.map(item => item.expectation.name), ['CONTAINS'])
    assert.equal(second.violations[0]!.actualCount, 0)
  } finally { store.close() }
})

test('shape evaluation query count is independent of instances × expectations', () => {
  const small = open()
  small.ingest('service EXPECTS owner\napi IS service')
  const smallCount = evaluationQueryCount(small)
  assert.deepEqual(smallCount, { queries: 5, checks: 1 })
  small.close()

  const large = open()
  const expectationCount = 20
  const instanceCount = 200
  large.ingest([
    ...Array.from({ length: expectationCount }, (_, index) => `service EXPECTS field-${index}`),
    ...Array.from({ length: instanceCount }, (_, index) => `entity/${index} IS service`)
  ].join('\n'))
  const largeCount = evaluationQueryCount(large)
  assert.equal(largeCount.checks, expectationCount * instanceCount)
  assert.equal(largeCount.queries, smallCount.queries)
  large.close()
})

test('violations make the report; satisfied instances do not (spec §20.2)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS owner',
    'api IS service',
    'billing IS service',
    'billing HAS owner: payments-team'
  ].join('\n'))
  const report = check(store)
  assert.equal(report.violations.length, 1)
  assert.equal(report.violations[0]!.entity, 'api')
  assert.equal(report.coverage.checks, 2)
  assert.equal(report.coverage.satisfied, 1)
  store.close()
})

test('stale claims are current beliefs past the horizon (spec §20.2)', () => {
  const store = open()
  store.ingest('auth USES jwt\nserver IS production')
  const now = Date.now()
  const later = () => now + 91 * 86_400_000
  assert.equal(check(store, { now: () => now }).stale.length, 0)
  const stale = check(store, { now: later }).stale
  assert.equal(stale.length, 2)
  assert.ok(stale.every(({ ageDays }) => ageDays >= 90))
  assert.equal(check(store, { now: later, staleDays: 365 }).stale.length, 0)
  store.close()
})

test('superseding a claim resets its staleness clock (spec §20.2)', () => {
  const store = open()
  store.ingest('auth USES jwt')
  // Belief series: the current row is the fresh one; only it is considered.
  store.ingest('auth USES jwt @ 90%')
  const now = Date.now()
  assert.equal(check(store, { now: () => now }).stale.length, 0)
  assert.equal(check(store, { now: () => now + 91 * 86_400_000 }).stale.length, 1, 'one current row, once')
  store.close()
})

test('review candidates are current beliefs at conf 0.3–0.7 (spec §20.2, §13.5)', () => {
  const store = open()
  store.ingest([
    'a IS b @ 20%',
    'c IS d @ 30%',
    'e IS f @ 50%',
    'g IS h @ 70%',
    'i IS j @ 90%'
  ].join('\n'))
  const review = check(store).review
  assert.deepEqual(review.map(row => row.conf), [0.3, 0.5, 0.7])
  store.close()
})

test('alias value disagreements surface across series (spec §20.2)', () => {
  const store = open()
  store.ingest([
    'postgres ALIAS postgresql',
    'postgres HAS version: 14',
    'postgresql HAS version: 15'
  ].join('\n'))
  const disagreements = check(store).disagreements
  assert.equal(disagreements.length, 1)
  assert.equal(disagreements[0]!.kind, 'value')
  assert.equal(disagreements[0]!.about, 'HAS version')
  assert.deepEqual(disagreements[0]!.entities, ['postgres', 'postgresql'])
  store.close()
})

test('alias polarity disagreements surface asserted vs negated (spec §20.2)', () => {
  const store = open()
  store.ingest([
    'postgres ALIAS postgresql',
    'postgres IS production',
    'postgresql IS NOT production'
  ].join('\n'))
  const disagreements = check(store).disagreements
  assert.equal(disagreements.length, 1)
  assert.equal(disagreements[0]!.kind, 'polarity')
  assert.equal(disagreements[0]!.about, 'IS production')
  store.close()
})

test('agreeing, retracted, and differently scoped series never disagree (spec §20.2)', () => {
  const store = open()
  store.ingest([
    'postgres ALIAS postgresql',
    'postgres HAS version: 15',
    'postgresql HAS version: 15 ; same value — agreement',
    'postgres IS production @prod',
    'postgresql IS NOT production @staging ; different scope — different fact',
    'postgres HAS license: bsd',
    'postgresql HAS license: mit'
  ].join('\n'))
  store.ingest('postgresql HAS license: mit @ 0% ; retracted — absence is not disagreement')
  assert.equal(check(store).disagreements.length, 0)
  store.close()
})

test('alias disagreement query count stays constant as scoped evidence grows', () => {
  const measure = (slots: number): number => {
    const store = open()
    try {
      store.ingest('left ALIAS right')
      for (let index = 0; index < slots; index++) {
        store.ingest(`left HAS field-${index}: 1`, { contexts: ['prod', 'west'], source: 'one' })
        store.ingest(`right HAS field-${index}: 2`, { contexts: ['west', 'prod'], source: 'two' })
        store.ingest(`right HAS field-${index}: 3`, { contexts: ['staging'], source: 'two' })
      }
      const database = store.db
      let queries = 0
      const report = check({ ...store, db: {
        exec: sql => database.exec(sql),
        prepare: sql => { queries++; return database.prepare(sql) },
        close: () => database.close()
      } })
      assert.equal(report.disagreements.length, slots)
      for (const disagreement of report.disagreements) {
        assert.deepEqual(disagreement.entities, ['left', 'right'])
        assert.deepEqual(disagreement.rows.map(row => row.value_text).sort(), ['1', '2'])
      }
      return queries
    } finally { store.close() }
  }
  assert.equal(measure(100), measure(1))
})

test('structured contexts preserve boundaries when checking alias disagreements', () => {
  const store = open()
  try {
    store.ingest('postgres ALIAS postgresql')
    store.ingest('postgres HAS version: 14', { contexts: ['prod\0west'] })
    store.ingest('postgresql HAS version: 15', { contexts: ['prod', 'west'] })
    assert.deepEqual(check(store).disagreements, [])

    // The same set still compares regardless of author order or source stamp.
    store.ingest('postgres HAS version: 16', {
      contexts: ['west', 'prod'], source: 'agent/review'
    })
    const disagreements = check(store).disagreements
    assert.equal(disagreements.length, 1)
    assert.equal(disagreements[0]!.rows.length, 2)
    assert.deepEqual(disagreements[0]!.rows.map(row => row.value_text).sort(), ['15', '16'])
  } finally {
    store.close()
  }
})

test('actor provenance stamps do not scope disagreements apart (spec §20.2, §9.5)', () => {
  const store = open()
  store.ingest('postgres ALIAS postgresql')
  store.ingest('postgres HAS version: 14', { source: 'cli' })
  store.ingest('postgresql HAS version: 15', { source: 'agent/claude' })
  assert.equal(check(store).disagreements.length, 1)
  store.close()
})

test('an actor fork within one alias name is not a cross-name disagreement', () => {
  const store = open()
  store.ingest('postgres ALIAS postgresql')
  store.ingest('postgres HAS version: 14', { source: 'agent/one' })
  store.ingest('postgres HAS version: 15', { source: 'agent/two' })
  assert.deepEqual(check(store).disagreements, [])
  store.close()
})

test('a second alias exposes a same-name fork even when it agrees with the first actor', () => {
  const store = open()
  store.ingest('postgres ALIAS postgresql')
  store.ingest('postgres HAS version: 14', { source: 'agent/one' })
  store.ingest('postgres HAS version: 15', { source: 'agent/two' })
  store.ingest('postgresql HAS version: 14', { source: 'import/catalog' })
  const disagreements = check(store).disagreements
  assert.equal(disagreements.length, 1)
  assert.deepEqual(disagreements[0]!.entities, ['postgres', 'postgresql'])
  assert.equal(disagreements[0]!.rows.length, 3)
  store.close()
})

test('multi-alias disagreements retain every actor-attributed row', () => {
  const store = open()
  store.ingest('postgres ALIAS postgresql\npostgresql ALIAS pg')
  store.ingest('postgres HAS version: 14', { source: 'agent/one' })
  store.ingest('postgres HAS version: 15', { source: 'agent/two' })
  store.ingest('postgresql HAS version: 14', { source: 'import/catalog' })
  store.ingest('pg HAS version: 16', { source: 'cli' })

  const disagreements = check(store).disagreements
  assert.equal(disagreements.length, 1)
  assert.deepEqual(disagreements[0]!.entities, ['pg', 'postgres', 'postgresql'])
  assert.equal(disagreements[0]!.rows.length, 4)
  assert.deepEqual(
    disagreements[0]!.rows.map(row =>
      store.toClaim(row).contexts.find(context => context.startsWith('src:'))).sort(),
    ['src:agent/one', 'src:agent/two', 'src:cli', 'src:import/catalog']
  )
  store.close()
})

test('coverage counts rows, facts, belief states and typed entities (spec §20.2)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS owner',
    'api IS service',
    'api HAS owner: platform-team',
    'auth USES jwt @ 50%',
    'server IS NOT compromised @ 90%'
  ].join('\n'))
  store.ingest('auth USES jwt @ 0% ; retracted')
  const { coverage } = check(store)
  assert.equal(coverage.rows, 6)
  assert.equal(coverage.facts, 5)
  assert.equal(coverage.current, 3, 'positive current: EXPECTS, IS, HAS')
  assert.equal(coverage.retracted, 1)
  assert.equal(coverage.negated, 1)
  assert.equal(coverage.lowConfidence, 0)
  assert.equal(coverage.entities, 5, 'service, api, owner, server, compromised — retracted auth/jwt drop out')
  assert.equal(coverage.typedEntities, 1, 'api IS service; the negated IS does not type server')
  assert.equal(coverage.expectations, 1)
  assert.equal(coverage.instances, 1)
  assert.equal(coverage.checks, 1)
  assert.equal(coverage.satisfied, 1)
  store.close()
})

test('an empty store checks clean (spec §20.2)', () => {
  const store = open()
  const report = check(store)
  assert.equal(report.violations.length, 0)
  assert.equal(report.coverage.rows, 0)
  assert.equal(report.coverage.averageConfidence, null)
  store.close()
})

test('health options reject invalid horizons and clocks before store reads', () => {
  const store = open()
  store.close()
  for (const staleDays of [NaN, Infinity, -Infinity, -1]) {
    assert.throws(() => check(store, { staleDays }), /staleDays must be finite and non-negative/)
  }
  for (const now of [NaN, Infinity, -Infinity]) {
    assert.throws(() => check(store, { now: () => now }), /now must return a finite timestamp/)
  }
})

test('shape evaluation refreshes peer inverse vocabulary before sharing its read snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-shape-vocabulary-'))
  const path = join(dir, 'knowledge.db')
  const writer = open(path)
  writer.ingest('HOSTS IS verb\nservice EXPECTS owner\napi IS service\napi HAS owner: team\nhost HOSTS api')
  const reader = open(path, { access: 'read-only' })
  try {
    assert.equal(evaluate(reader).checks, 1)
    assert.deepEqual(evaluate(reader).violations, [])
    writer.ingest('service EXPECTS HOSTED-BY')
    assert.equal(evaluate(reader).violations.length, 1)
    writer.ingest('HOSTS REVERSE HOSTED-BY')
    const before = writer.exportText({ tx: true, maxSensitivity: 'restricted' })
    const result = evaluate(reader)
    assert.equal(result.checks, 2)
    assert.deepEqual(result.violations, [])
    assert.deepEqual(evaluate(reader), result)
    assert.equal(writer.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})
