import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { open } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import { clientFormatVersion, generateClient } from '@cavelang/shape'

// Keep imports in the workspace, outside the project's source/test include globs.
// A concurrent composite build must not emit these temporary client fixtures.
const generatedClientPrefix = fileURLToPath(new URL('../.generated-client-', import.meta.url))

const schema = [
  'service EXPECTS owner #cardinality:one',
  'service EXPECTS latency #unit:ms',
  'service EXPECTS USES',
  'team EXPECTS PART-OF #cardinality:one'
]

test('client generation keeps relation mappings with the declaration snapshot', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-client-snapshot-'))
  const path = join(dir, 'knowledge.db')
  const writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('SERVED-BY IS verb\nservice EXPECTS SERVED-BY', { strict: true })
  const reader = open(path, { access: 'read-only' })
  try {
    const expected = generateClient(reader)
    assert.ok(expected.ok)
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
            writer.ingest('SERVES REVERSE SERVED-BY\nservice EXPECTS SERVED-BY #cardinality:one', { strict: true })
          }
          return rows
        })
      }
      return statement
    })
    assert.deepEqual(generateClient(reader), expected)
    assert.equal(injected, true)
    const next = generateClient(reader)
    assert.ok(next.ok)
    assert.equal(next.fields[0]!.cardinality, 'one')
    assert.equal(next.fields[0]!.primary, 'SERVES')
    assert.equal(next.fields[0]!.inverse, true)
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('client snapshots release after read errors and preserve caller rollback', t => {
  const store = open()
  try {
    store.ingest('service EXPECTS owner')
    const expected = generateClient(store)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const failure = new Error('read failed')
    const prepare = store.db.prepare.bind(store.db)
    let fail = true
    t.mock.method(store.db, 'prepare', (sql: string) => {
      if (fail && sql.includes("WHERE verb = 'EXPECTS'")) {
        fail = false
        throw failure
      }
      return prepare(sql)
    })
    assert.throws(() => generateClient(store), error => error === failure)
    const rollback = new Error('caller rollback')
    assert.throws(() => store.transaction(() => {
      store.ingest('service EXPECTS repo')
      const generated = generateClient(store)
      assert.ok(generated.ok)
      assert.equal(generated.fields.length, 2)
      throw rollback
    }), error => error === rollback)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.deepEqual(generateClient(store), expected)
  } finally { store.close() }
})

test('field identity preserves separators in type and property names', () => {
  const store = open()
  try {
    store.ingest('a\0attribute\0b EXPECTS c\na EXPECTS b\0attribute\0c', { strict: true })
    const generated = generateClient(store)
    assert.ok(generated.ok, generated.ok ? '' : generated.problems.join('; '))
    assert.deepEqual(generated.fields.map(field => [field.type, field.name]), [
      ['a', 'b\0attribute\0c'], ['a\0attribute\0b', 'c']
    ])
  } finally { store.close() }
})

test('generated clients typecheck with special properties and value-namespace names', () => {
  const store = open()
  const dir = mkdtempSync(generatedClientPrefix)
  try {
    store.ingest([...schema,
      'service EXPECTS __proto__',
      'query-sql EXPECTS owner',
      '123-type EXPECTS owner',
      'a\0attribute\0b EXPECTS c',
      'a EXPECTS b\0attribute\0c'
    ].join('\n'), { strict: true })
    const generated = generateClient(store)
    assert.ok(generated.ok)
    const path = join(dir, 'client.ts')
    writeFileSync(path, generated.code)
    const consumer = join(dir, 'consumer.ts')
    writeFileSync(consumer, `
import type { Store } from '@cavelang/store'
import { readService, type CaveValue } from './client.js'
declare const store: Store
const service = readService(store, 'api')
const owner: CaveValue = service.owner
const unit: 'ms' = service.latency[0]!.unit
const relations: readonly string[] = service.USES
// @ts-expect-error cardinality one exposes a scalar, not an array
const owners: readonly CaveValue[] = service.owner
// @ts-expect-error unconstrained cardinality exposes an array, not a scalar
const latency: CaveValue<'ms'> = service.latency
// @ts-expect-error the unit is constrained by the schema
const seconds: 's' = service.latency[0]!.unit
// @ts-expect-error generated fields are read-only
service.owner = owner
// @ts-expect-error generated collections are read-only
service.USES.push('another')
// @ts-expect-error only declared fields belong to the generated interface
service.undeclared
`)
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
    execFileSync(process.execPath, [tsc, '--noEmit', '--strict', '--skipLibCheck',
      '--target', 'ES2022', '--module', 'NodeNext', '--allowImportingTsExtensions', path, consumer],
    { encoding: 'utf8', timeout: 30_000 })
    const project = fileURLToPath(new URL('../tsconfig.json', import.meta.url))
    const included = execFileSync(process.execPath, [tsc, '--project', project, '--listFilesOnly'],
      { encoding: 'utf8', timeout: 30_000 }).replaceAll('\\', '/').split(/\r?\n/)
    assert.ok(included.includes(fileURLToPath(import.meta.url).replaceAll('\\', '/')))
    assert.ok(!included.includes(path.replaceAll('\\', '/')))
    assert.ok(!included.includes(consumer.replaceAll('\\', '/')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    store.close()
  }
})

test('typed client generation is deterministic, sorted, and versioned (spec §20.4)', () => {
  const a = open()
  const b = open()
  a.ingest(schema.join('\n'))
  b.ingest([...schema].reverse().join('\n'))
  const left = generateClient(a)
  const right = generateClient(b)
  assert.equal(left.ok, true)
  assert.equal(right.ok, true)
  if (!left.ok || !right.ok) return
  assert.equal(left.version, clientFormatVersion)
  assert.equal(left.digest, right.digest)
  assert.equal(left.code, right.code)
  assert.match(left.code, /Generated by CAVE typed-client\/v1/)
  assert.match(left.code, /readonly "owner": CaveValue<undefined>/)
  assert.match(left.code, /readonly "latency": readonly CaveValue<"ms">\[\]/)
  assert.match(left.code, /relationValues\(store, entity, "CONTAINS", true\)/)
  a.close()
  b.close()
})

test('equivalent source declarations preserve client identity and conflicting revisions recover', () => {
  const store = open()
  try {
    store.ingest('service EXPECTS latency #unit:ms')
    const baseline = generateClient(store)
    assert.equal(baseline.ok, true)
    store.ingest('service EXPECTS latency #cardinality:some #unit:ms @src:second\n' +
      'service EXPECTS latency #unit:ms @src:third @ 80%')
    assert.deepEqual(generateClient(store), baseline,
      'source contexts, positive confidence and an explicit default do not change the client')
    store.ingest('service EXPECTS latency #unit:s @src:second')
    const rejected = generateClient(store)
    assert.deepEqual(rejected, { ok: false, problems: [
      'service EXPECTS latency: conflicting current declarations'
    ] })
    store.ingest('service EXPECTS latency #unit:ms @src:second')
    assert.deepEqual(generateClient(store), baseline, 'corrected current declarations restore the exact client')
    store.ingest('service EXPECTS latency @src:third @ 0%')
    assert.deepEqual(generateClient(store), baseline, 'retiring a redundant source does not change the schema')
  } finally { store.close() }
})

test('generated readers execute against the store and enforce exact-one cardinality', async () => {
  const store = open()
  store.ingest(schema.join('\n'))
  store.ingest('service EXPECTS __proto__')
  store.ingest([
    'api IS service',
    'api HAS owner: platform',
    'api HAS latency: 20ms',
    'api HAS __proto__: ordinary-data',
    'api USES postgres'
  ].join('\n'))
  const generated = generateClient(store)
  assert.equal(generated.ok, true)
  if (!generated.ok) return
  const dir = mkdtempSync(generatedClientPrefix)
  const path = join(dir, 'client.ts')
  try {
    writeFileSync(path, generated.code)
    const client = await import(pathToFileURL(path).href) as {
      readService(store: Store, entity: string): {
        owner: { text: string }, latency: readonly { text: string, unit: string }[], USES: readonly string[]
      }
    }
    const api = client.readService(store, 'api')
    assert.ok(Object.hasOwn(api, '__proto__'), 'special property names remain own data properties')
    assert.equal(Object.getPrototypeOf(api), Object.prototype)
    assert.equal((api as unknown as { __proto__: { text: string }[] }).__proto__[0]!.text, 'ordinary-data')
    assert.equal(api.owner.text, 'platform')
    assert.deepEqual(api.latency.map(value => ({ ...value })), [{ text: '20ms', number: 20, unit: 'ms' }])
    assert.deepEqual(api.USES, ['postgres'])
    store.ingest('bad IS service\nbad HAS owner: platform\nbad HAS latency: 1s')
    assert.throws(() => client.readService(store, 'bad'), /expected unit ms/)
    store.ingest('api HAS owner: security @src:review')
    assert.throws(() => client.readService(store, 'api'), /expected exactly one value, got 2/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    store.close()
  }
})

test('generated readers retain one snapshot across concurrent field updates', async t => {
  const dir = mkdtempSync(generatedClientPrefix)
  const db = join(dir, 'knowledge.db')
  const writer = open(db)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('service EXPECTS first #cardinality:one\nservice EXPECTS second #cardinality:one\nservice EXPECTS USES\napi HAS first: old\napi HAS second: old\napi USES old-target')
  const reader = open(db, { access: 'read-only' })
  try {
    const generated = generateClient(reader)
    assert.ok(generated.ok)
    const path = join(dir, 'client.ts')
    writeFileSync(path, generated.code)
    const client = await import(pathToFileURL(path).href) as {
      readService(store: Store, entity: string): { first: { text: string }, second: { text: string }, USES: readonly string[] }
    }
    const prepare = reader.db.prepare.bind(reader.db)
    let injected = false
    t.mock.method(reader.db, 'prepare', (sql: string) => {
      const statement = prepare(sql)
      if (sql.includes('AS text')) {
        const all = statement.all.bind(statement)
        t.mock.method(statement, 'all', (...params: (string | number)[]) => {
          const rows = all(...params)
          if (!injected) {
            injected = true
            writer.ingest('api HAS first: new\napi HAS second: new\napi USES old-target @ 0%\napi USES new-target')
          }
          return rows
        })
      }
      return statement
    })
    const first = client.readService(reader, 'api')
    assert.equal(injected, true)
    assert.deepEqual([first.first.text, first.second.text], ['old', 'old'])
    assert.deepEqual(first.USES, ['old-target'], 'relation reads share the attribute snapshot')
    const next = client.readService(reader, 'api')
    assert.deepEqual([next.first.text, next.second.text], ['new', 'new'])
    assert.deepEqual(next.USES, ['new-target'])
    assert.throws(() => client.readService(reader, 'missing'), /expected exactly one value/)
    writer.ingest('api HAS first: recovered\napi HAS second: recovered')
    const recovered = client.readService(reader, 'api')
    assert.deepEqual([recovered.first.text, recovered.second.text], ['recovered', 'recovered'])
    const rollback = new Error('caller rollback')
    assert.throws(() => writer.transaction(() => {
      writer.ingest('api HAS first: temporary')
      assert.equal(client.readService(writer, 'api').first.text, 'temporary')
      throw rollback
    }), error => error === rollback)
    assert.equal(client.readService(writer, 'api').first.text, 'recovered')
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('schema changes deterministically change generated clients', () => {
  const store = open()
  store.ingest('service EXPECTS owner')
  const before = generateClient(store)
  store.ingest('service EXPECTS repo')
  const after = generateClient(store)
  assert.ok(before.ok && after.ok)
  if (!before.ok || !after.ok) return
  assert.notEqual(after.digest, before.digest)
  assert.doesNotMatch(before.code, /"repo"/)
  assert.match(after.code, /readonly "repo"/)
  store.ingest('service EXPECTS repo @ 0%')
  const retracted = generateClient(store)
  assert.ok(retracted.ok)
  if (retracted.ok) assert.equal(retracted.digest, before.digest)
  store.close()
})

test('generated interfaces cannot collide with emitted type bindings', () => {
  const store = open()
  try {
    store.ingest('store EXPECTS owner\ncave-value EXPECTS owner\nstore EXPECTS repo')
    const result = generateClient(store)
    assert.deepEqual(result, { ok: false, problems: [
      'type "cave-value" generates reserved client type CaveValue; rename the CAVE type',
      'type "store" generates reserved client type Store; rename the CAVE type'
    ] })
  } finally { store.close() }
})

test('value-only helper names do not reserve generated interface names', () => {
  const store = open()
  try {
    store.ingest('query-sql EXPECTS owner')
    assert.equal(generateClient(store).ok, true)
  } finally { store.close() }
})

test('unsupported and ambiguous expectations fail with all actionable problems', () => {
  const store = open()
  store.ingest([
    'service EXPECTS owner #cardinality:many',
    'service EXPECTS USES #unit:ms',
    'api-service EXPECTS repo',
    'api/service EXPECTS owner',
    'team EXPECTS PART-OF #cardinality:one @src:a',
    'team EXPECTS PART-OF @src:b'
  ].join('\n'))
  const result = generateClient(store)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.problems.join('\n'), /cardinality must be one or some/)
  assert.match(result.problems.join('\n'), /relation expectations cannot declare #unit/)
  assert.match(result.problems.join('\n'), /both generate ApiService/)
  assert.match(result.problems.join('\n'), /conflicting current declarations/)
  assert.deepEqual(generateClient(store, { version: 2 }), {
    ok: false,
    problems: ['unsupported typed-client format version 2; supported: 1']
  })
  store.close()
})

test('generated readers preserve query and snapshot-release failures', async t => {
  const store = open()
  const dir = mkdtempSync(generatedClientPrefix)
  try {
    store.ingest('service EXPECTS owner\napi IS service\napi HAS owner: platform')
    const generated = generateClient(store)
    assert.ok(generated.ok)
    const path = join(dir, 'client.ts')
    writeFileSync(path, generated.code)
    const client = await import(pathToFileURL(path).href) as { readService(store: Store, entity: string): unknown }
    const expected = client.readService(store, 'api')
    const failure = new Error('query failed'), releaseFailure = new Error('release failed')
    const exec = store.db.exec.bind(store.db)
    let releases = 0
    t.mock.method(store.db, 'prepare', () => { throw failure })
    t.mock.method(store.db, 'exec', (sql: string) => {
      exec(sql)
      if (sql === 'RELEASE cave_client_read') { releases++; throw releaseFailure }
    })
    assert.throws(() => client.readService(store, 'api'), error => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.cause, failure)
      assert.deepEqual(error.errors, [failure, releaseFailure])
      return true
    })
    assert.equal(releases, 1)
    t.mock.restoreAll()
    assert.deepEqual(client.readService(store, 'api'), expected)
  } finally { t.mock.restoreAll(); store.close(); rmSync(dir, { recursive: true, force: true }) }
})
