import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { syncDb, syncFile, syncText, type SyncOptions } from '@cavelang/sync'

for (const entrypoint of ['database', 'file', 'text'] as const) {
  for (const flag of ['dryRun', 'record'] as const) {
    test(`${entrypoint} sync rejects malformed ${flag} before merging`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'cave-sync-options-'))
      const store = open()
      try {
        const path = join(dir, entrypoint === 'database' ? 'source.db' : 'source.cave')
        const source = open(join(dir, 'source.db'))
        let text: string
        try {
          source.ingest('api IS synced')
          text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
        } finally { source.close() }
        if (entrypoint !== 'database') writeFileSync(path, text)
        const run = (options: SyncOptions) => entrypoint === 'database' ? syncDb(store, path, options)
          : entrypoint === 'file' ? syncFile(store, path, options) : syncText(store, text, options)
        const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
        const before = history()
        for (const value of ['true', 'false', null, 0, 1, [], {}]) {
          assert.throws(() => run({ [flag]: value as never }), new RegExp(`${flag} must be a boolean`))
          assert.equal(history(), before)
        }
        run({ dryRun: true })
        assert.equal(history(), before)
        run({ dryRun: false, record: false })
        assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'synced'))
        const committed = history()
        run({ record: false })
        assert.equal(history(), committed)
      } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
    })
  }
}
