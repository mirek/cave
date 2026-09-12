import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { open } from '@cavelang/store'
import { actCommand, addCommand, backupCommand, checkCommand, deriveCommand, exportCommand, generateCommand, importCommand, queryCommand, querySourcesCommand, reconstructCommand, reportCommand, resolveCommand, searchCommand, suggestAliasCommand, syncCommand } from '@cavelang/cli'

const modes = ['add', 'import', 'query', 'sources', 'search', 'resolve', 'derive', 'act', 'check', 'backup', 'aliases', 'sync', 'sync-json', 'sync-json-rejected', 'report', 'export', 'generate', 'report-file', 'export-file', 'generate-file', 'reconstruct', 'invalid-add', 'failed-export', 'failed-sources'] as const
for (const mode of modes) test(`CLI preserves structured output through store close: ${mode}`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-store-close-'))
  const db = join(dir, 'store.db'), source = join(dir, 'source.db'), input = join(dir, 'input.cave'), template = join(dir, 'report.md')
  const seed = open(db), peer = open(source)
  try {
    seed.ingest('api IS service')
    peer.ingest('remote IS service')
    if (mode === 'failed-sources') seed.ingest('source/a HAS path: https://records.test/a.cave')
  } finally { seed.close(); peer.close() }
  writeFileSync(input, mode === 'invalid-add' ? 'broken' : 'new IS retained')
  writeFileSync(template, '# Report\n\nSummary.\n')
  const args = ['--db', db]
  const output = join(dir, 'deliverable.txt')
  const expectedPublished = mode === 'report-file' ? reportCommand([...args, template]).out
    : mode === 'export-file' ? exportCommand(args).out
    : mode === 'generate-file' ? generateCommand(args).out : undefined
  if (expectedPublished !== undefined) writeFileSync(output, 'previous deliverable\n')
  const run = () => {
    switch (mode) {
      case 'add': case 'invalid-add': return addCommand([...args, input, '--strict'])
      case 'import': return importCommand([...args, input])
      case 'query': return queryCommand([...args, '?x IS service'])
      case 'sources': case 'failed-sources': return querySourcesCommand([...args, '--sources', '?x IS service'], { fetchImpl: async () => { throw new Error('source loading failed') } })
      case 'search': return searchCommand([...args, 'api'])
      case 'resolve': return resolveCommand(args)
      case 'derive': return deriveCommand([...args, '--list'])
      case 'act': return actCommand([...args, '--list'])
      case 'check': return checkCommand(args)
      case 'backup': return backupCommand([...args, '--out', join(dir, 'backup.db')])
      case 'aliases': return suggestAliasCommand(args)
      case 'sync': return syncCommand([...args, source, '--no-record'])
      case 'sync-json': return syncCommand([...args, source, '--no-record', '--json'])
      case 'sync-json-rejected': return syncCommand([...args, input, '--json'])
      case 'report': return reportCommand([...args, template])
      case 'report-file': return reportCommand([...args, template, '--out', output])
      case 'export': return exportCommand(args)
      case 'export-file': return exportCommand([...args, '--out', output])
      case 'failed-export': return exportCommand([...args, '--out', dir])
      case 'generate': return generateCommand(args)
      case 'generate-file': return generateCommand([...args, '--out', output])
      case 'reconstruct': return reconstructCommand([...args, 'api'])
    }
  }
  let closes = 0
  try {
    const close = DatabaseSync.prototype.close
    const target = realpathSync(db)
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      const location = this.location()
      close.call(this)
      if (location !== null && realpathSync(location) === target) {
        closes++
        throw new Error('command store close failed')
      }
    })
    const result = await run()
    assert.equal(result.code, 1)
    assert.equal(closes, 1)
    assert.match(result.err, /command store close failed/)
    if (mode === 'invalid-add') assert.match(result.err, /line 1/)
    else if (mode === 'failed-export') assert.match(result.err, /output destination is not a regular file/)
    else if (mode === 'failed-sources') assert.match(result.err, /source loading failed/)
    else assert.notEqual(result.out, '', 'completed command output is retained')
    if (mode === 'sync-json' || mode === 'sync-json-rejected') {
      const report = JSON.parse(result.out)
      assert.equal(report.merged, mode === 'sync-json' ? 1 : 0)
      assert.equal(report.problems.length > 0, mode === 'sync-json-rejected')
    }
    if (expectedPublished !== undefined) {
      assert.notEqual(expectedPublished, '')
      assert.equal(readFileSync(output, 'utf8'), expectedPublished, 'store cleanup does not undo complete file publication')
      assert.ok(result.out.includes(output), 'stdout retains the published destination')
    }
    t.mock.restoreAll()
    const reopened = open(db)
    try {
      const text = reopened.exportText({ current: true })
      assert.match(text, /api IS service/)
      if (mode === 'add' || mode === 'import') assert.match(text, /new IS retained/)
      if (mode === 'sync' || mode === 'sync-json') assert.match(text, /remote IS service/)
      reopened.ingest('caller IS usable')
    } finally { reopened.close() }
  } finally { t.mock.restoreAll(); rmSync(dir, { recursive: true, force: true }) }
})

test('async CLI cleanup waits for source loading and retains the completed query output', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-async-close-'))
  const db = join(dir, 'store.db'), seed = open(db)
  try { seed.ingest('source/a HAS path: https://records.test/a.cave') } finally { seed.close() }
  let release!: (response: Response) => void
  const response = new Promise<Response>(resolve => { release = resolve })
  let started = false, settled = false, closes = 0
  let command: ReturnType<typeof querySourcesCommand> | undefined
  try {
    const target = realpathSync(db), close = DatabaseSync.prototype.close
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      const location = this.location()
      close.call(this)
      if (location !== null && realpathSync(location) === target) { closes++; throw new Error('async store close failed') }
    })
    command = querySourcesCommand(['--db', db, '--sources', '?x IS service'], {
      fetchImpl: () => { started = true; return response }
    })
    void command.then(() => { settled = true }, () => { settled = true })
    for (let attempt = 0; attempt < 100 && !started; attempt++) await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(started, true)
    assert.equal(settled, false)
    assert.equal(closes, 0)
    release(new Response('remote IS service'))
    const result = await command
    assert.equal(result.code, 1)
    assert.match(result.out, /remote/)
    assert.match(result.err, /async store close failed/)
    assert.equal(closes, 1)
    t.mock.restoreAll()
    const reopened = open(db)
    try { assert.doesNotMatch(reopened.exportText({ current: true }), /remote IS service/) } finally { reopened.close() }
  } finally {
    release(new Response('remote IS service'))
    if (command) await command
    t.mock.restoreAll()
    rmSync(dir, { recursive: true, force: true })
  }
})
