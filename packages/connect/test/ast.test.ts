import { test } from 'node:test'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'
import { Ast, Template } from '../src/index.ts'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const mapping = Template.parse('?id HAS name: ?name').mapping!

test('a rejecting custom iterator is closed and cleanup failures retain both causes', async () => {
  for (const failCleanup of [false, true]) {
    const store = open()
    const extraction = new Error('next failed')
    const cleanup = new Error('return failed')
    let closed = 0
    const source: Ast.Query = { iterate: () => ({ [Symbol.asyncIterator]: () => ({
      next: async () => { throw extraction },
      return: async () => { closed++; if (failCleanup) throw cleanup; return { done: true, value: undefined } }
    }) }) }
    try {
      const before = store.exportText({ tx: true })
      await assert.rejects(Ast.connect(store, mapping, source, { name: 'cleanup' }), error => {
        if (failCleanup) {
          assert.ok(error instanceof AggregateError)
          assert.deepEqual(error.errors, [extraction, cleanup])
        } else assert.equal(error, extraction)
        return true
      })
      assert.equal(closed, 1)
      assert.equal(store.exportText({ tx: true }), before)
    } finally { store.close() }
  }
})

test('real mirek/ast JSON traversal feeds the connector', { skip: !process.env['CAVE_AST_MODULE'] }, async () => {
  const { createJsonAdapter, select } = await import(pathToFileURL(process.env['CAVE_AST_MODULE']!).href)
  const directory = await mkdtemp(join(tmpdir(), 'cave-ast-query-'))
  const store = open()
  try {
    const file = join(directory, 'manifest.json')
    await writeFile(file, '{"name":"demo","version":"1.0.0"}')
    const adapter = createJsonAdapter()
    const projected = select(adapter, { uri: file }, 'json::property').project((node: { snapshot: { id: { local: string }, attributes: { name: string }, origin: { uri: string } } }) => ({
      data: { id: node.snapshot.id.local, name: node.snapshot.attributes.name }, source: node.snapshot.origin.uri
    }))
    const report = await Ast.connect(store, mapping, projected, { name: 'json-tree', key: 'id', prune: true, diagnostics: () => adapter.diagnostics() })
    assert.equal(report.records, 2)
    assert.deepEqual(query(store, '?id HAS name: ?name').map(item => item.bindings['name']).sort(), ['name', 'version'])
    assert.equal(adapter.statistics().opened, adapter.statistics().closed)
  } finally { store.close(); await rm(directory, { recursive: true, force: true }) }
})
const row = (id: string, name: string): Ast.Record => ({ data: { id, name }, source: `${id}.ts`, span: { startLine: 2, endLine: 3 } })
const selection = (...rows: Ast.Record[]): Ast.Query => ({ iterate: () => ({ async *[Symbol.asyncIterator]() { yield* rows } }) })

test('AST refresh keeps per-file provenance, skips unchanged rows and prunes missing rows', async () => {
  const store = open()
  try {
    const options = { name: 'ast-test', key: 'id', prune: true }
    const first = await Ast.connect(store, mapping, selection(row('a', 'Alice'), row('b', 'Bob')), options)
    assert.equal(first.added, 2)
    assert.equal(query(store, '?id HAS name: ?name @src:a.ts#L2-L3').length, 1)
    const before = store.exportText({ tx: true })
    assert.equal((await Ast.connect(store, mapping, selection(row('a', 'Alice'), row('b', 'Bob')), options)).skipped, 2)
    assert.equal(store.exportText({ tx: true }), before)
    await Ast.connect(store, mapping, selection(row('a', 'Ann')), options)
    assert.deepEqual(query(store, '?id HAS name: ?name').map(item => item.bindings), [{ id: 'a', name: 'Ann' }])
  } finally { store.close() }
})

test('late extraction, diagnostics and mapping failures cannot publish or prune', async () => {
  const store = open()
  try {
    const options = { name: 'ast-test', key: 'id', prune: true }
    await Ast.connect(store, mapping, selection(row('old', 'Retained')), options)
    const before = store.exportText({ tx: true })
    const broken: Ast.Query = { iterate: () => ({ async *[Symbol.asyncIterator]() { yield row('new', 'Discarded'); throw new Error('parse failed') } }) }
    await assert.rejects(Ast.connect(store, mapping, broken, options), /parse failed/)
    await assert.rejects(Ast.connect(store, mapping, selection(row('new', 'Discarded')), { ...options, diagnostics: () => [{ severity: 'error', message: 'bad syntax' }] }), /bad syntax/)
    await assert.rejects(Ast.connect(store, mapping, selection(row('new', 'Discarded'), { data: { name: 'No identity' }, source: 'bad.ts' }), options), /mapping failed/)
    await assert.rejects(Ast.connect(store, mapping, selection(row('new', 'Discarded'), { ...row('bad', 'Bad'), span: { startLine: 0, endLine: 1 } }), options), /span/)
    assert.equal(store.exportText({ tx: true }), before)
  } finally { store.close() }
})

test('bounds and cancellation close upstream iteration and preserve the store', async () => {
  const store = open()
  const controller = new AbortController()
  let closed = 0
  const source: Ast.Query = { iterate: ({ signal }) => ({ async *[Symbol.asyncIterator]() {
    assert.equal(signal, controller.signal)
    try { yield row('a', 'A'); yield row('b', 'B') } finally { closed++ }
  } }) }
  try {
    const before = store.exportText({ tx: true })
    await assert.rejects(Ast.connect(store, mapping, source, { name: 'ast', maxRecords: 1, signal: controller.signal }), /maxRecords/)
    assert.equal(closed, 1)
    await assert.rejects(Ast.connect(store, mapping, source, { name: 'ast', signal: controller.signal, diagnostics() { controller.abort(new Error('stop')); return [] } }), /stop/)
    assert.equal(closed, 2)
    assert.equal(store.exportText({ tx: true }), before)
  } finally { store.close() }
})
