import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'

test('failed explicit reload does not mark an external vocabulary commit as loaded', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-registry-reload-'))
  const path = join(dir, 'knowledge.db')
  const writer = open(path)
  writer.ingest('HOSTS IS verb\nHOSTS REVERSE HOSTED-BY\nfirst HOSTS api')
  const reader = open(path, { access: 'read-only' })
  try {
    writer.ingest('HOSTED-BY RENAMED-TO RESIDENT-ON\nsecond HOSTS api')
    const failure = new Error('external vocabulary reload interrupted')
    const prepare = reader.db.prepare.bind(reader.db)
    const interception = t.mock.method(reader.db, 'prepare', (sql: string) => {
      if (sql.includes('SELECT subject, verb, object FROM cave_claim')) throw failure
      return prepare(sql)
    })
    assert.throws(() => reader.reloadRegistry(), error => error === failure)
    interception.mock.restore()
    assert.deepEqual(reader.registry(), writer.registry())
    const facts = reader.reverse('api')
    assert.equal(facts.length, 2)
    assert.ok(facts.every(fact => fact.rel === 'RESIDENT-ON'))
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})
