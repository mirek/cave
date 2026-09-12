import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { createToolSurface } from '../src/server.ts'

test('MCP reconstruction retains one graph snapshot across cue expansions', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-reconstruction-'))
  const path = join(dir, 'knowledge.db'), writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('a USES b\nb USES c\nc IS service')
  const reader = open(path, { access: 'read-only' })
  try {
    const surface = createToolSurface(reader), args = { seeds: ['a'], maxSteps: 8 }
    const before = surface.call('cave_reconstruct', args)
    assert.equal(before.isError, undefined)
    assert.match(before.content[0].text, /c IS service/)
    const forward = reader.forward.bind(reader)
    let changed = false
    t.mock.method(reader, 'forward', (...args: Parameters<typeof forward>) => {
      const result = forward(...args)
      if (!changed) {
        changed = true
        writer.ingest('b USES c @ 0%\nb USES d\nd IS replacement')
      }
      return result
    })
    assert.deepEqual(surface.call('cave_reconstruct', args), before)
    assert.equal(changed, true)
    const after = surface.call('cave_reconstruct', args)
    assert.equal(after.isError, undefined)
    assert.match(after.content[0].text, /d IS replacement/)
    assert.notDeepEqual(after, before)
    assert.deepEqual(after, createToolSurface(writer).call('cave_reconstruct', args))
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('MCP reconstruction leaves successful and failed reads inside caller rollback', () => {
  const store = open(), surface = createToolSurface(store), rollback = new Error('outer rollback')
  try {
    assert.throws(() => store.transaction(() => {
      store.ingest('a USES b')
      const result = surface.call('cave_reconstruct', { seeds: ['a'] })
      assert.equal(result.isError, undefined)
      assert.match(result.content[0].text, /a USES b/)
      assert.equal(surface.call('cave_reconstruct', { seeds: [] }).isError, true)
      assert.deepEqual(surface.call('cave_reconstruct', { seeds: ['a'] }), result)
      throw rollback
    }), error => error === rollback)
    assert.equal(store.currentBeliefs().length, 0)
    store.ingest('a USES c')
    assert.match(surface.call('cave_reconstruct', { seeds: ['a'] }).content[0].text, /a USES c/)
  } finally { store.close() }
})
