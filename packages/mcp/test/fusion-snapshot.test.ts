import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { createToolSurface } from '../src/server.ts'

test('historical MCP fusion groups quantities using aliases at the requested cutoff', () => {
  const store = open(), surface = createToolSurface(store)
  try {
    const beforeMerge = store.ingest('a HAS score: 10 ms +/- 2 ms @src:first\nb HAS score: 20 ms +/- 2 ms @src:second').ids.at(-1)!
    const args = { pattern: '?entity HAS score: ?score', aliases: true }
    const separate = surface.call('cave_fuse', { ...args, asOf: beforeMerge })
    assert.equal(separate.isError, true)
    assert.match(separate.content[0].text, /cannot fuse across 2 quantities/)
    const mergedAt = store.ingest('a ALIAS b').ids.at(-1)!
    assert.deepEqual(surface.call('cave_fuse', { ...args, asOf: beforeMerge }), separate)
    const merged = surface.call('cave_fuse', { ...args, asOf: mergedAt })
    assert.equal(merged.isError, undefined)
    assert.match(merged.content[0].text, /fused 2 estimate\(s\)/)
    assert.match(merged.content[0].text, /mean 15,/)
    store.ingest('a ALIAS b @ 0%')
    const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.deepEqual(surface.call('cave_fuse', { ...args, asOf: mergedAt }), merged)
    assert.equal(surface.call('cave_fuse', args).isError, true)
    assert.deepEqual(surface.call('cave_fuse', { ...args, asOf: beforeMerge }), separate)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
  } finally { store.close() }
})

for (const selector of ['about', 'pattern'] as const) {
  test(`MCP fusion retains one alias snapshot for ${selector} selection and grouping`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-fusion-'))
    const path = join(dir, 'knowledge.db'), writer = open(path)
    writer.db.exec('PRAGMA journal_mode = WAL')
    writer.ingest('a ALIAS b\na HAS score: 10 ms +/- 2 ms @src:first\nb HAS score: 20 ms +/- 2 ms @src:second')
    const reader = open(path, { access: 'read-only' })
    try {
      const surface = createToolSurface(reader)
      const args = { ...(selector === 'about' ? { about: 'a' } : { pattern: 'a HAS score: ?score' }), aliases: true }
      const before = surface.call('cave_fuse', args)
      assert.equal(before.isError, undefined)
      assert.match(before.content[0].text, /fused 2 estimate\(s\)/)
      const aliasesOf = reader.aliasesOf.bind(reader)
      let changed = false
      t.mock.method(reader, 'aliasesOf', (...args: Parameters<typeof aliasesOf>) => {
        const aliases = aliasesOf(...args)
        if (!changed) {
          changed = true
          writer.ingest('a ALIAS b @ 0%')
        }
        return aliases
      })
      assert.deepEqual(surface.call('cave_fuse', args), before)
      assert.equal(changed, true)
      const after = surface.call('cave_fuse', args)
      assert.equal(after.isError, undefined)
      assert.match(after.content[0].text, /fused 1 estimate\(s\)/)
      assert.deepEqual(after, createToolSurface(writer).call('cave_fuse', args))
    } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}

test('literal MCP fusion uses one store alias snapshot without selecting or appending stored estimates', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-literal-fusion-'))
  const path = join(dir, 'knowledge.db'), writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('a ALIAS b\na HAS score: 1000 ms +/- 2 ms @src:stored')
  const reader = open(path, { access: 'read-only' })
  try {
    const surface = createToolSurface(reader)
    const args = { text: 'a HAS score: 10 ms +/- 2 ms @src:first\nb HAS score: 20 ms +/- 2 ms @src:second', aliases: true }
    const initialHistory = writer.exportText({ tx: true })
    const before = surface.call('cave_fuse', args)
    assert.equal(before.isError, undefined)
    assert.match(before.content[0].text, /fused 2 estimate\(s\)/)
    assert.match(before.content[0].text, /mean 15,/)
    assert.doesNotMatch(before.content[0].text, /@src:stored/)
    assert.equal(writer.exportText({ tx: true }), initialHistory)
    const aliasesOf = reader.aliasesOf.bind(reader)
    let changed = false
    t.mock.method(reader, 'aliasesOf', (...args: Parameters<typeof aliasesOf>) => {
      const aliases = aliasesOf(...args)
      if (!changed) {
        changed = true
        writer.ingest('a ALIAS b @ 0%')
      }
      return aliases
    })
    assert.deepEqual(surface.call('cave_fuse', args), before)
    assert.equal(changed, true)
    const history = writer.exportText({ tx: true })
    const after = surface.call('cave_fuse', args)
    assert.equal(after.isError, true)
    assert.match(after.content[0].text, /cannot fuse across 2 quantities/)
    assert.equal(writer.exportText({ tx: true }), history)
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('MCP fusion retains the caller transaction after success and selection failure', () => {
  const store = open(), surface = createToolSurface(store)
  const rollback = new Error('caller rollback')
  try {
    assert.throws(() => store.transaction(() => {
      store.ingest('a IS 10 ms +/- 2 ms')
      assert.equal(surface.call('cave_fuse', { about: 'a' }).isError, undefined)
      assert.equal(surface.call('cave_fuse', { about: 'a', text: 'a IS 20 ms +/- 2 ms' }).isError, true)
      assert.match(surface.call('cave_fuse', { about: 'a' }).content[0].text, /fused 1 estimate/)
      throw rollback
    }), error => error === rollback)
    assert.equal(store.currentBeliefs().length, 0)
    store.ingest('b IS 20 ms +/- 2 ms')
    assert.match(surface.call('cave_fuse', { about: 'b' }).content[0].text, /fused 1 estimate/)
  } finally { store.close() }
})
