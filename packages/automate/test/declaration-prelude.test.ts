import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Registry } from '@cavelang/canonical'
import { open } from '@cavelang/store'
import { declareActions } from '@cavelang/act'
import { declareRules, Rule } from '@cavelang/rules'
import { declareAutomations } from '@cavelang/automate'

const cases = [
  { name: 'rules', declare: declareRules, owner: 'derive', declaration: '?x IS service => ?x IS watched' },
  { name: 'actions', declare: declareActions, owner: 'act', declaration: 'action/watch HAS action: `?x => ?x IS watched`' },
  { name: 'automations', declare: declareAutomations, owner: 'automate', declaration: 'automation/watch HAS automation: `?x IS service => hook/log`' },
]
const count = (store: ReturnType<typeof open>): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n

for (const { name, declare, owner, declaration } of cases) {
  test(`${name}: large invalid preludes retain every source diagnostic without writes`, () => {
    const store = open()
    const size = 130_000
    try {
      store.ingest('existing IS preserved')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const text = [declaration, ...Array.from({ length: size }, () => 'broken')].join('\n')
      const result = declare(store, text)
      assert.equal(result.declared, 0)
      assert.equal(result.unchanged, 0)
      assert.equal(result.prelude, 0)
      assert.equal(result.problems.length, size)
      for (let i = 0; i < size; i++) {
        assert.equal(result.problems[i]!.line, i + 2)
        assert.ok(result.problems[i]!.message.length > 0)
      }
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.deepEqual(declare(store, declaration).problems, [])
      assert.equal(declare(store, declaration).unchanged, 1)
    } finally { store.close() }
  })

  test(`${name}: invalid preludes are atomic, keep failing on retry, and recover when corrected`, () => {
    const store = open()
    try {
      store.ingest('existing IS preserved')
      const before = count(store)
      const prelude = 'MANAGES IS verb\nMANAGES REVERSE MANAGED-BY\napi IS service'
      const text = `${prelude}\nbroken\n${declaration}`
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = declare(store, text)
        assert.ok(result.problems.length > 0)
        assert.equal(result.declared, 0)
        assert.equal(result.prelude, 0)
        assert.equal(count(store), before)
        assert.equal(Registry.primaryOf(store.registry(), 'MANAGED-BY').isInverse, false)
      }
      const corrected = `${prelude}\n${declaration}`
      const result = declare(store, corrected)
      assert.deepEqual(result.problems, [])
      assert.equal(result.declared, 1)
      assert.ok(result.prelude >= 3)
      const after = count(store)
      const repeated = declare(store, corrected)
      assert.deepEqual(repeated.problems, [])
      assert.equal(repeated.declared, 0)
      assert.equal(repeated.unchanged, 1)
      assert.equal(repeated.prelude, 0)
      assert.equal(count(store), after)
    } finally {
      store.close()
    }
  })

  test(`${name}: an old cached digest cannot hide an invalid prelude`, () => {
    const store = open()
    try {
      const prelude = 'api IS service\nbroken'
      store.ingest(`${owner}/prelude HAS ${owner}-digest: ${Rule.digestOf(prelude)} @src:cave-${owner}`)
      const before = count(store)
      assert.ok(declare(store, prelude).problems.length > 0)
      assert.equal(count(store), before)
    } finally {
      store.close()
    }
  })
}


for (const { name, declare, declaration } of cases) {
  test(`${name}: cached declaration vocabulary refreshes peer inverses and renames`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-declaration-vocabulary-'))
    const store = open(join(dir, 'store.db'))
    const peer = open(join(dir, 'store.db'))
    try {
      store.registry()
      peer.ingest('MANAGES IS verb\nMANAGES REVERSE MANAGED-BY')
      assert.deepEqual(declare(store, `api MANAGED-BY alice\n${declaration}`).problems, [])
      assert.ok(store.currentBeliefs().some(row => row.subject === 'alice' && row.verb === 'MANAGES' && row.object === 'api'))
      peer.ingest('MANAGES RENAMED-TO SUPERVISES')
      const text = `bob SUPERVISES web\n${declaration}`
      assert.deepEqual(declare(store, text).problems, [])
      assert.ok(store.currentBeliefs().some(row => row.subject === 'bob' && row.verb === 'MANAGES' && row.object === 'web'))
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.equal(declare(store, text).unchanged, 1)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { peer.close(); store.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}
