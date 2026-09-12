import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Declared, Template, assemble, connect } from '@cavelang/connect'

for (const flag of ['force', 'prune', 'preludeLifecycle'] as const) {
  test(`connect rejects malformed ${flag} before publishing units`, () => {
    const store = open()
    try {
      const { mapping, problems } = Template.parse('?id IS service')
      assert.deepEqual(problems, [])
      const records = [{ id: 'api' }]
      const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const before = history()
      for (const value of ['true', 'false', null, 0, 1, [], {}]) {
        assert.throws(() => connect(store, mapping!, records, { name: 'services', key: 'id', [flag]: value as never }),
          new RegExp(`${flag} must be a boolean`))
        assert.equal(history(), before)
      }
      const corrected = connect(store, mapping!, records, { name: 'services', key: 'id', [flag]: false })
      assert.equal(corrected.failures.length, 0)
      assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'service'))
      const committed = history()
      const repeated = connect(store, mapping!, records, { name: 'services', key: 'id' })
      assert.equal(repeated.skipped, 1)
      assert.equal(history(), committed)
    } finally { store.close() }
  })
}

for (const [entrypoint, flags] of [
  ['run', ['force', 'prune']],
  ['discovery', ['force', 'prune', 'skipFollowed']],
  ['assemble', ['force']]
] as const) {
  for (const flag of flags) {
    test(`declared ${entrypoint} rejects malformed ${flag} before source work`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'cave-declared-options-'))
      const root = join(dir, 'target.db'), store = open(root)
      try {
        writeFileSync(join(dir, 'source.cave'), 'api IS service')
        store.ingest('source/services HAS path: source.cave')
        const ready = Declared.prepareSync({ name: 'services', path: 'source.cave' }, dir)
        const invoke = (options: { force?: boolean, prune?: boolean, skipFollowed?: boolean }) =>
          entrypoint === 'run' ? Declared.run(store, ready, options)
            : entrypoint === 'discovery' ? Declared.discovery(store, root, options) : assemble(store, root, options)
        const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
        const before = history()
        for (const value of ['true', 'false', null, 0, 1, [], {}]) {
          await assert.rejects(async () => invoke({ [flag]: value as never }), new RegExp(`${flag} must be a boolean`))
          assert.equal(history(), before)
        }
        await invoke({})
        if (entrypoint === 'discovery') assert.equal(history(), before)
        else assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'service'))
      } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
    })
  }
}
