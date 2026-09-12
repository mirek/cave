import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'

for (const current of [false, true]) for (const tx of [false, true]) {
  test(`export keeps claims and lineage on one read snapshot (current=${current}, tx=${tx})`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-export-snapshot-'))
    const path = join(dir, 'knowledge.db')
    const writer = open(path)
    writer.db.exec('PRAGMA journal_mode = WAL')
    const inserted = writer.ingest('parent IS ready\ncondition IS satisfied')
    const reader = open(path, { access: 'read-only' })
    try {
      const options = { current, tx }
      const before = reader.exportText(options)
      const prepare = reader.db.prepare.bind(reader.db)
      let injected = false
      t.mock.method(reader.db, 'prepare', (sql: string) => {
        if (!injected && sql.includes('SELECT parent_id, role, child_id FROM cave_edge')) {
          injected = true
          writer.transaction(() => {
            writer.ingest('new IS committed')
            writer.appendEdges([{ parentId: inserted.ids[0]!, role: 'WHEN', childId: inserted.ids[1]! }])
          })
        }
        return prepare(sql)
      })
      assert.equal(reader.exportText(options), before)
      assert.equal(injected, true)
      const after = reader.exportText(options)
      assert.match(after, /new IS committed/)
      assert.match(after, /WHEN condition IS satisfied/)
      assert.equal(after, writer.exportText(options))
    } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}
