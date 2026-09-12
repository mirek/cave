import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'

for (const method of ['resolvedBeliefs', 'contested', 'forward', 'reverse', 'topicMembers', 'topicsOf'] as const) {
  test(`${method} keeps policy and claims on one read snapshot`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-resolution-snapshot-'))
    const path = join(dir, 'knowledge.db')
    const writer = open(path)
    writer.db.exec('PRAGMA journal_mode = WAL')
    writer.ingest('source/first HAS precedence: 10\nsource/second HAS precedence: 0\nalice CONTAINS bob @ 90% @src:first\nalice CONTAINS NOT bob @ 80% @src:second')
    const reader = open(path, { access: 'read-only' })
    const read = (store: typeof reader) => {
      if (method === 'resolvedBeliefs' || method === 'contested') return store[method]()
      return store[method](method === 'forward' || method === 'topicMembers' ? 'alice' : 'bob', { resolve: true })
    }
    try {
      const before = read(reader)
      const prepare = reader.db.prepare.bind(reader.db)
      let injected = false
      t.mock.method(reader.db, 'prepare', (sql: string) => {
        if (!injected && sql.includes('SELECT context') && sql.includes("substr(context, 1, 4) = 'src:'")) {
          injected = true
          writer.ingest('source/first HAS precedence: 0\nsource/second HAS precedence: 10\nalice CONTAINS NOT bob @ 95% @src:second\nalice CONTAINS carol @src:first\nalice CONTAINS NOT carol @src:second\ndave CONTAINS bob @src:first\ndave CONTAINS NOT bob @src:second')
        }
        return prepare(sql)
      })
      assert.deepEqual(read(reader), before)
      assert.equal(injected, true)
      const after = read(reader)
      assert.notDeepEqual(after, before)
      assert.deepEqual(after, read(writer))
    } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}
