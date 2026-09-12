import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { createToolSurface } from '../src/server.ts'

for (const tool of ['cave_about', 'cave_neighbors'] as const) for (const resolve of [false, true]) {
  test(`${tool} retains one entity snapshot (resolve=${resolve})`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-entity-'))
    const path = join(dir, 'knowledge.db'), writer = open(path)
    writer.db.exec('PRAGMA journal_mode = WAL')
    writer.ingest('a ALIAS b\na USES c\nb IS service\nc USES a')
    const reader = open(path, { access: 'read-only' })
    try {
      const surface = createToolSurface(reader), args = { entity: 'a', aliases: true, resolve }
      const before = surface.call(tool, args)
      assert.equal(before.isError, undefined)
      let changed = false
      const update = () => {
        if (!changed) {
          changed = true
          writer.ingest('a ALIAS b @ 0%\nb IS changed\nc USES a @ 0%\nd USES a')
        }
      }
      if (tool === 'cave_about') {
        const aliasesOf = reader.aliasesOf.bind(reader)
        t.mock.method(reader, 'aliasesOf', (...args: Parameters<typeof aliasesOf>) => {
          const result = aliasesOf(...args)
          update()
          return result
        })
      } else {
        const forward = reader.forward.bind(reader)
        t.mock.method(reader, 'forward', (...args: Parameters<typeof forward>) => {
          const result = forward(...args)
          update()
          return result
        })
      }
      assert.deepEqual(surface.call(tool, args), before)
      assert.equal(changed, true)
      const after = surface.call(tool, args)
      assert.equal(after.isError, undefined)
      assert.notDeepEqual(after, before)
      assert.deepEqual(after, createToolSurface(writer).call(tool, args))
    } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}

for (const tool of ['cave_about', 'cave_neighbors'] as const) {
  test(`${tool} retains caller writes for outer rollback after successful and invalid reads`, () => {
    const store = open(), surface = createToolSurface(store), rollback = new Error('outer rollback')
    try {
      assert.throws(() => store.transaction(() => {
        store.ingest('a USES b')
        const result = surface.call(tool, { entity: 'a' })
        assert.equal(result.isError, undefined)
        assert.match(result.content[0].text, /a USES b/)
        assert.equal(surface.call(tool, { entity: '' }).isError, true)
        assert.deepEqual(surface.call(tool, { entity: 'a' }), result)
        throw rollback
      }), error => error === rollback)
      assert.equal(store.currentBeliefs().length, 0)
      store.ingest('a USES c')
      assert.match(surface.call(tool, { entity: 'a' }).content[0].text, /a USES c/)
    } finally { store.close() }
  })
}
