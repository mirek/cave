import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { match, Pattern, query } from '@cavelang/query'

for (const method of ['query', 'match'] as const) {
  test(`${method} keeps inverse vocabulary and claims on one snapshot`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-query-vocabulary-'))
    const writer = open(join(dir, 'knowledge.db'))
    writer.db.exec('PRAGMA journal_mode = WAL')
    const seed = writer.ingest('HOSTS IS verb\nHOSTS REVERSE RESIDENT-ON\nrack HOSTS api')
    const reader = open(join(dir, 'knowledge.db'), { access: 'read-only' })
    const input = '?service RESIDENT-ON rack'
    const read = (store: typeof reader) => method === 'query'
      ? query(store, input) : match(store, Pattern.parse(input))
    try {
      const before = read(reader)
      assert.equal(before.length, 1)
      const registry = reader.registry.bind(reader)
      let injected = false
      t.mock.method(reader, 'registry', () => {
        const result = registry()
        if (!injected) {
          injected = true
          writer.transaction(() => {
            writer.appendEdges([{ parentId: seed.ids[2]!, role: 'WHEN', childId: seed.ids[1]! }])
            writer.ingest('SERVES IS verb\nSERVES REVERSE RESIDENT-ON\nrack HOSTS worker\nrack SERVES other')
          })
        }
        return result
      })
      assert.deepEqual(read(reader), before)
      assert.equal(injected, true)
      const after = read(reader)
      assert.deepEqual(after, read(writer))
      assert.deepEqual(after.map(result => result.bindings['service']), ['other'])
      assert.equal(query(reader, 'rack HOSTS ?service').length, 2)
    } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}
