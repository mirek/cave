import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'

for (const resolve of [false, true]) for (const aliases of [false, true]) {
  test(`reverse keeps inverse vocabulary and facts on one snapshot (resolve=${resolve}, aliases=${aliases})`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-reverse-snapshot-'))
    const path = join(dir, 'knowledge.db')
    const writer = open(path)
    writer.db.exec('PRAGMA journal_mode = WAL')
    writer.ingest('HOSTS IS verb\nHOSTS REVERSE HOSTED-BY\nfirst HOSTS api')
    const reader = open(path, { access: 'read-only' })
    try {
      const before = reader.reverse('api', { resolve, aliases })
      assert.equal(before[0]!.rel, 'HOSTED-BY')
      const prepare = reader.db.prepare.bind(reader.db)
      let injected = false
      t.mock.method(reader.db, 'prepare', (sql: string) => {
        if (!injected && sql.includes('AND object IS NOT NULL')) {
          injected = true
          writer.ingest('HOSTED-BY RENAMED-TO RESIDENT-ON\nsecond HOSTS api')
        }
        return prepare(sql)
      })
      assert.deepEqual(reader.reverse('api', { resolve, aliases }), before)
      assert.equal(injected, true)
      const after = reader.reverse('api', { resolve, aliases })
      assert.equal(after.length, 2)
      assert.ok(after.every(fact => fact.rel === 'RESIDENT-ON'))
      assert.deepEqual(after, writer.reverse('api', { resolve, aliases }))
    } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}
