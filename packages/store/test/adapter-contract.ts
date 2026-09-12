import * as assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Confidence, Key, Uuidv7 } from '@cavelang/core'
import * as ClaimRecord from '../src/record.ts'
import { canonicalizeText, Registry } from '@cavelang/canonical'
import { openWith } from '../src/runtime.ts'
import type { Adapter } from '../src/adapter.ts'
import type { AppendOptions } from '../src/store.ts'
import * as Schema from '../src/schema.ts'

type Expectations = {
  readonly backup: boolean
  readonly fullText: 'fts4' | 'fts5'
  readonly loadExtension: boolean
}

/** Register the same behavioral contract for every supported SQLite adapter. */
export const sqliteAdapterContract = (
  adapter: Adapter,
  expectations: Expectations
): void => {
  test(`${adapter.name}: current export omits unrelated malformed history but validates remapped endpoints`, () => {
    const store = openWith(adapter)
    try {
      const old = store.ingest('api HAS score: 1').ids[0]!
      const child = store.ingest('review EXISTS').ids[0]!
      store.ingest('api HAS score: 2')
      const expected = [false, true].map(tx => store.exportText({ current: true, tx }))
      // This malformed superseded row retains its key, so current selection
      // still chooses the valid newer revision of the same attribute.
      store.db.prepare('UPDATE cave_claim SET object = ? WHERE id = ?').run('conflicting-object', old)
      const snapshot = () => JSON.stringify({ claims: store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(),
        edges: store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all() })
      const rejected = (error: unknown): boolean => {
        assert.ok(error instanceof Error)
        assert.ok(error.message.includes(old))
        assert.match(error.message, /payload/)
        assert.ok(error.cause instanceof Error)
        return true
      }
      const before = snapshot()
      for (const [index, tx] of [false, true].entries()) {
        assert.equal(store.exportText({ current: true, tx }), expected[index])
        assert.throws(() => store.exportText({ tx }), rejected)
        assert.equal(snapshot(), before)
      }
      store.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)').run(old, 'WHEN', child)
      const linked = snapshot()
      for (const tx of [false, true]) {
        assert.throws(() => store.exportText({ current: true, tx }), rejected)
        assert.equal(snapshot(), linked)
      }
      store.db.prepare('UPDATE cave_claim SET object = NULL WHERE id = ?').run(old)
      const text = store.exportText({ current: true, tx: true })
      const parsed = canonicalizeText(text)
      assert.deepEqual(parsed.problems, [])
      assert.equal(parsed.claims.length, 2)
      assert.equal(parsed.edges.length, 1)
      assert.match(text, /score: 2/)
      assert.match(text, /WHEN review/)
      assert.equal(store.exportText({ current: true, tx: true }), text)
    } finally { store.close() }
  })

  test(`${adapter.name}: current export rejects a historical key that redirects an edge to another claim`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('parent EXISTS\n  WHEN child EXISTS')
      const old = store.currentBeliefs().find(row => row.subject === 'parent')!
      store.ingest('parent EXISTS\nother EXISTS')
      const other = store.currentBeliefs().find(row => row.subject === 'other')!
      const original = store.exportText({ current: true, tx: true })
      store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(other.claim_key, old.id)
      const snapshot = () => JSON.stringify({ claims: store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(),
        edges: store.db.prepare('SELECT * FROM cave_edge').all() })
      const before = snapshot()
      for (const tx of [false, true]) {
        assert.throws(() => store.exportText({ current: true, tx }), error => {
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes(old.id))
          assert.match(error.message, /historical claim key/)
          assert.ok(error.cause instanceof Error)
          return true
        })
        assert.equal(snapshot(), before)
      }
      store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(old.claim_key, old.id)
      assert.equal(store.exportText({ current: true, tx: true }), original)
    } finally { store.close() }
  })

  test(`${adapter.name}: current export rejects a current key that redirects a historical edge`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('parent EXISTS\n  WHEN child EXISTS')
      const parent = store.currentBeliefs().find(row => row.subject === 'parent')!
      store.ingest('other EXISTS')
      const other = store.currentBeliefs().find(row => row.subject === 'other')!
      const original = store.exportText({ current: true })
      store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(parent.claim_key, other.id)
      const snapshot = () => JSON.stringify(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all())
      const before = snapshot()
      for (const tx of [false, true]) {
        assert.throws(() => store.exportText({ current: true, tx }), error => {
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes(other.id))
          assert.match(error.message, /stored claim key/)
          assert.ok(error.cause instanceof Error)
          return true
        })
        assert.equal(snapshot(), before)
      }
      store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(other.claim_key, other.id)
      assert.equal(store.exportText({ current: true }), original)
    } finally { store.close() }
  })

  test(`${adapter.name}: source stamping rejects non-string actor options`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('existing IS preserved')
      const before = store.exportText({ tx: true })
      for (const value of [null, 42, false, {}, [], new String('manual')]) {
        for (const lifecycle of [false, true]) {
          for (const text of ['', 'first EXISTS\nsecond EXISTS @src:manual']) {
            let reads = 0
            const options = { lifecycle, get source() { reads++; return value } } as AppendOptions
            assert.throws(() => store.ingest(text, options),
              { name: 'TypeError', message: /append source must be a string/ })
            assert.equal(reads, 1)
            assert.equal(store.exportText({ tx: true }), before)
          }
        }
      }
      const accepted = store.ingest('accepted EXISTS @src:manual', { source: 'agent/reviewer', lifecycle: true })
      assert.deepEqual(store.provenanceOf(accepted.ids[0]!), {
        actors: ['agent/reviewer'], runs: ['agent/reviewer'], sources: ['manual'], domains: []
      })
    } finally { store.close() }
  })

  test(`${adapter.name}: provenance values cannot be coerced into attribution`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('existing IS preserved')
      const before = store.exportText({ tx: true })
      for (const field of ['actor', 'run', 'sources', 'domains'] as const) {
        for (const value of [null, 42, false, {}, [], new String('manual')]) {
          for (const text of ['', 'first EXISTS\nsecond EXISTS']) {
            const provenance = { [field]: field === 'sources' || field === 'domains' ? [value] : value }
            assert.throws(() => store.ingest(text, { provenance } as AppendOptions),
              { name: 'TypeError', message: new RegExp(`append provenance.${field}.*string`) })
            assert.equal(store.exportText({ tx: true }), before)
          }
        }
      }
      const accepted = store.ingest('accepted EXISTS', {
        provenance: { actor: '', run: '', sources: ['', 'manual'], domains: ['', 'team/platform'] }
      })
      assert.deepEqual(store.provenanceOf(accepted.ids[0]!), {
        actors: [], runs: [], sources: ['manual'], domains: ['team/platform']
      })
    } finally { store.close() }
  })

  test(`${adapter.name}: malformed provenance containers cannot disappear during append`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('existing IS preserved')
      const before = store.exportText({ tx: true })
      for (const value of [null, '', 'manual', 0, true, [], () => ({ actor: 'agent/test' })]) {
        for (const text of ['', 'first EXISTS\nsecond EXISTS']) {
          for (const structured of [false, true]) {
            let reads = 0
            const options = { get provenance() { reads++; return value } } as AppendOptions
            assert.throws(() => structured ? store.insertResult(canonicalizeText(text, store.registry()), options) :
              store.ingest(text, options), { name: 'TypeError', message: /append provenance must be an object/ })
            assert.equal(reads, 1)
            assert.equal(store.exportText({ tx: true }), before)
          }
        }
      }
      assert.equal(store.ingest('accepted EXISTS', { provenance: {} }).ids.length, 1)
    } finally { store.close() }
  })

  test(`${adapter.name}: append option collections reject non-arrays before conversion`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('existing IS preserved')
      const before = store.exportText({ tx: true })
      for (const name of ['ids', 'contexts', 'sources', 'domains'] as const) {
        for (const value of [null, '', 'manual', 0, {}, new Set(), { length: 0 }]) {
          for (const source of ['', 'first EXISTS\nsecond EXISTS']) {
            let reads = 0
            const collection = { get [name]() { reads++; return value } }
            const options = name === 'sources' || name === 'domains' ? { provenance: collection } : collection
            assert.throws(() => store.insertResult(canonicalizeText(source, store.registry()), options as AppendOptions),
              new RegExp(`append .*${name} must be an array`))
            assert.equal(reads, 1)
            assert.equal(store.exportText({ tx: true }), before)
          }
        }
      }
      assert.equal(store.ingest('accepted EXISTS', { contexts: ['production'],
        provenance: { sources: ['manual'], domains: ['team/platform'] } }).ids.length, 1)
    } finally { store.close() }
  })

  test(`${adapter.name}: metadata collections are validated before capture can coerce them`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('existing IS preserved')
      const before = store.exportText({ tx: true })
      for (const field of ['contexts', 'tags'] as const) {
        for (const value of [undefined, null, '', 'manual', 0, {}, new Set(), { length: 0 }]) {
          const result = canonicalizeText('first EXISTS\nsecond EXISTS', store.registry())
          const claims = result.claims.map((entry, index) => index === 0 ? entry :
            { ...entry, claim: { ...entry.claim, [field]: value } as typeof entry.claim })
          assert.throws(() => store.insertResult({ ...result, claims }), new RegExp(`${field} must be an array`))
          assert.equal(store.exportText({ tx: true }), before)
        }
      }
    } finally { store.close() }
  })

  test(`${adapter.name}: non-string literal text cannot be coerced during append`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('existing IS preserved')
      const before = store.exportText({ tx: true })
      for (const text of [[], ['word'], new String('word')]) {
        for (const source of ['second EXISTS', 'second USES "word"', 'second HAS label: "word"']) {
          const result = canonicalizeText(`first EXISTS\n${source}`, store.registry())
          const claims = result.claims.map((entry, index) => {
            if (index === 0) return entry
            const claim = entry.claim
            const patch = claim.payload.kind === 'none' ? { subject: { kind: 'text', text } } :
              claim.payload.kind === 'relation' ? { payload: { ...claim.payload, object: { kind: 'text', text } } } :
              claim.payload.kind === 'attribute' ? { payload: { ...claim.payload, value: { ...claim.payload.value, raw: text } } } : {}
            return { ...entry, claim: { ...claim, ...patch } as typeof claim }
          })
          assert.throws(() => store.insertResult({ ...result, claims }), TypeError)
          assert.equal(store.exportText({ tx: true }), before)
        }
      }
    } finally { store.close() }
  })

  test(`${adapter.name}: malformed claim flags reject the entire structured append`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('existing IS preserved')
      const before = store.exportText({ tx: true })
      for (const flag of ['negated', 'importance'] as const) {
        for (const value of [undefined, null, 'true', 'false', 0, 1, {}, []]) {
          const result = canonicalizeText('first EXISTS\nsecond EXISTS', store.registry())
          const claims = result.claims.map((entry, index) => index === 0 ? entry :
            { ...entry, claim: { ...entry.claim, [flag]: value } as typeof entry.claim })
          assert.throws(() => store.insertResult({ ...result, claims }),
            { name: 'TypeError', message: new RegExp(`${flag} must be a boolean`) })
          assert.equal(store.exportText({ tx: true }), before)
        }
      }
      assert.equal(store.ingest('accepted EXISTS !').ids.length, 1)
    } finally { store.close() }
  })

  test(`${adapter.name}: malformed write flags cannot enable partial imports or alter stamping`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('existing IS preserved')
      const before = store.exportText({ tx: true })
      for (const invalid of [null, 'true', 'false', 0, 1, {}, []]) {
        let reads = 0
        assert.throws(() => store.ingest('partial IS forbidden\nbroken', { get strict() {
          reads++; return invalid as boolean
        } }), { name: 'TypeError', message: /ingest strict must be a boolean/ })
        assert.equal(reads, 1)
        for (const structured of [false, true]) {
          const options = { source: 'agent/test', get lifecycle() { reads++; return invalid as boolean } }
          const beforeReadCount: number = reads
          assert.throws(() => structured ?
            store.insertResult(canonicalizeText('partial IS forbidden @src:manual', store.registry()), options) :
            store.ingest('partial IS forbidden @src:manual\nbroken', options),
          { name: 'TypeError', message: /append lifecycle must be a boolean/ })
          assert.equal(reads, beforeReadCount + 1)
        }
        assert.equal(store.exportText({ tx: true }), before)
      }
      assert.throws(() => store.ingest('partial IS forbidden\nbroken', { strict: true }), /CAVE ingest failed/)
      assert.equal(store.exportText({ tx: true }), before)
      const lenient = store.ingest('accepted IS written\nbroken', { strict: false })
      assert.equal(lenient.ids.length, 1)
      assert.equal(lenient.problems.length, 1)
      const lifecycle = store.ingest('event IS recorded @src:manual', { source: 'agent/test', lifecycle: true })
      assert.deepEqual(store.provenanceOf(lifecycle.ids[0]!).runs, ['agent/test'])
    } finally { store.close() }
  })

  test(`${adapter.name}: traversal and resolution reject malformed boolean flags`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('alpha ALIAS alias-alpha\nalpha USES current\nalias-alpha USES extra')
      const before = store.exportText({ tx: true })
      const traversals = ['forward', 'reverse', 'topicMembers', 'topicsOf'] as const
      for (const method of traversals) {
        for (const flag of ['negated', 'retracted', 'aliases', 'resolve'] as const) {
          for (const invalid of [null, 'true', 'false', 0, 1, {}, []]) {
            let reads = 0
            const options = Object.defineProperty({}, flag, { get() { reads++; return invalid } })
            assert.throws(() => store[method]('alpha', options), { name: 'TypeError', message: new RegExp(`traversal ${flag} must be a boolean`) })
            assert.equal(reads, 1)
          }
          assert.doesNotThrow(() => store[method]('alpha', { [flag]: true }))
        }
        assert.deepEqual(store[method]('alpha', { negated: false, retracted: false, aliases: false, resolve: false }), store[method]('alpha'))
      }
      for (const method of ['resolvedBeliefs', 'contested'] as const) {
        for (const invalid of [null, 'true', 'false', 0, 1, {}, []]) {
          let reads = 0
          assert.throws(() => store[method]({ get aliases() { reads++; return invalid as boolean } }),
            { name: 'TypeError', message: new RegExp(`${method} aliases must be a boolean`) })
          assert.equal(reads, 1)
        }
        assert.deepEqual(store[method]({ aliases: false }), store[method]())
        assert.doesNotThrow(() => store[method]({ aliases: true }))
      }
      assert.ok(store.forward('alpha').some(fact => fact.target === 'current'))
      assert.equal(store.exportText({ tx: true }), before)
    } finally { store.close() }
  })

  test(`${adapter.name}: claimsAbout rejects malformed alias flags and preserves history`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('js ALIAS javascript\njavascript IS language @ 80%\njavascript IS language @ 90%')
      const before = store.exportText({ tx: true })
      for (const invalid of [null, 'true', 'false', 0, 1, {}, []]) {
        let reads = 0
        assert.throws(() => store.claimsAbout('js', { get aliases() {
          return (++reads === 1 ? invalid : true) as boolean
        } }), { name: 'TypeError', message: /claimsAbout aliases must be a boolean/ })
        assert.equal(reads, 1)
      }
      assert.deepEqual(store.claimsAbout('js', { aliases: false }), store.claimsAbout('js'))
      const history = store.claimsAbout('js', { aliases: true }).filter(row => row.verb === 'IS')
      assert.deepEqual(history.map(row => row.conf), [0.9, 0.8])
      assert.equal(store.exportText({ tx: true }), before)
    } finally { store.close() }
  })

  test(`${adapter.name}: raw search mode rejects malformed switches and preserves literal defaults`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('alpha IS service\nbeta IS service')
      const before = store.exportText({ tx: true })
      for (const invalid of [null, 'true', 'false', 0, 1, {}, []]) {
        let reads = 0
        assert.throws(() => store.search('alpha OR beta', { get raw() {
          return (++reads === 1 ? invalid : true) as boolean
        } }), { name: 'TypeError', message: /search raw must be a boolean/ })
        assert.equal(reads, 1)
      }
      assert.equal(store.search('alpha OR beta', { raw: true }).length, 2)
      assert.equal(store.search('alpha OR beta', { raw: false }).length, 0)
      assert.deepEqual(store.search('alpha OR beta'), store.search('alpha OR beta', { raw: false }))
      assert.equal(store.exportText({ tx: true }), before)
    } finally { store.close() }
  })

  test(`${adapter.name}: search and export reject invalid sensitivity options without changing defaults`, () => {
    const store = openWith(adapter)
    try {
      for (const populated of [false, true]) {
        if (populated) store.ingest('public IS marker #sensitivity:public\nsecret IS marker #sensitivity:restricted')
        const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        for (const invalid of [null, '', 'PUBLIC', 'unknown', 0, false, {}, []]) {
          for (const operation of ['search', 'export'] as const) {
            let reads = 0
            const options = { get maxSensitivity() {
              return (++reads === 1 ? invalid : 'public') as 'public'
            } }
            assert.throws(() => operation === 'search' ? store.search('marker', options) : store.exportText(options),
              { name: 'TypeError', message: /maxSensitivity must be/ })
            assert.equal(reads, 1)
          }
        }
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
        assert.equal(store.search('marker').length, populated ? 2 : 0)
        assert.equal(store.search('marker', { maxSensitivity: 'public' }).length, populated ? 1 : 0)
        assert.equal(store.exportText(), populated ? 'public IS marker #sensitivity:public\n' : '')
      }
    } finally { store.close() }
  })

  test(`${adapter.name}: export rejects malformed history and annotation switches`, () => {
    const store = openWith(adapter)
    try {
      for (const populated of [false, true]) {
        if (populated) store.ingest('api HAS state: before\napi HAS state: after')
        const history = store.exportText({ tx: true })
        for (const name of ['current', 'tx'] as const) {
          for (const value of [null, 'true', 'false', 0, 1, {}, []]) {
            let reads = 0
            const options = Object.defineProperty({}, name, { get() {
              reads++; return reads === 1 ? value : true
            } })
            assert.throws(() => store.exportText(options), {
              name: 'TypeError', message: new RegExp(`exportText ${name} must be a boolean`)
            })
            assert.equal(reads, 1)
          }
        }
        assert.equal(store.exportText({ tx: true }), history)
        const current = store.exportText({ current: true, tx: false })
        assert.equal(current, populated ? 'api HAS state: after\n' : '')
        assert.equal(store.exportText({ current: false, tx: false }), store.exportText())
      }
    } finally { store.close() }
  })

  test(`${adapter.name}: current confidence thresholds reject malformed values and preserve inclusive endpoints`, () => {
    const store = openWith(adapter)
    try {
      for (const populated of [false, true]) {
        if (populated) store.ingest('zero EXISTS @ 0%\nhalf EXISTS @ 50%\nfull EXISTS')
        const history = store.exportText({ tx: true })
        let coerced = 0
        for (const minConf of [NaN, Infinity, -Infinity, -0.1, 1.1, null, '0.5', false, 1n,
          { valueOf() { coerced++; return 0.5 } }]) {
          let reads = 0
          assert.throws(() => store.currentBeliefs({ get minConf() {
            reads++; return (reads === 1 ? minConf : 0) as number
          } }), { name: 'TypeError', message: /minConf.*finite.*0\.\.1/ })
          assert.equal(reads, 1)
        }
        assert.equal(coerced, 0)
        assert.equal(store.exportText({ tx: true }), history)
        assert.equal(store.currentBeliefs({ minConf: 0 }).length, populated ? 3 : 0)
        assert.equal(store.currentBeliefs({ minConf: Number.MIN_VALUE }).length, populated ? 2 : 0)
        assert.equal(store.currentBeliefs({ minConf: 0.5 }).length, populated ? 2 : 0)
        assert.equal(store.currentBeliefs({ minConf: 1 }).length, populated ? 1 : 0)
      }
    } finally { store.close() }
  })

  test(`${adapter.name}: export preserves self edges and current revision self-remaps`, () => {
    for (const remapped of [false, true]) {
      const store = openWith(adapter)
      try {
        const first = store.ingest('claim EXISTS @ 70%').ids[0]!
        const last = remapped ? store.ingest('claim EXISTS @ 90%').ids[0]! : first
        store.appendEdges([{ parentId: last, childId: first, role: 'BECAUSE' }])
        const before = JSON.stringify(store.db.prepare('SELECT * FROM cave_edge').all())
        for (const tx of [false, true]) {
          const text = store.exportText({ current: true, tx })
          assert.match(text, /BECAUSE claim/)
          const parsed = canonicalizeText(text)
          assert.deepEqual(parsed.problems, [])
          assert.equal(parsed.edges.length, 1)
          assert.equal(parsed.edges[0]!.role, 'BECAUSE')
          assert.equal(Key.of(parsed.claims[0]!.claim), Key.of(parsed.claims[1]!.claim))
          assert.equal(parsed.claims[0]!.claim.conf, remapped ? 0.9 : 0.7)
          assert.equal(parsed.claims[1]!.claim.conf, remapped ? 0.9 : 0.7)
          if (tx) assert.equal(text.split(last).length - 1, 2, 're-statement retains the same transaction identity')
        }
        assert.match(store.exportText(), /BECAUSE claim/)
        assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM cave_edge').all()), before)
      } finally { store.close() }
    }
  })

  test(`${adapter.name}: structured edge writes reject invalid roles and indices atomically`, () => {
    const store = openWith(adapter)
    try {
      const [parentId, childId] = store.ingest('parent IS fact\nchild IS condition').ids
      const before = store.exportText({ tx: true })
      const registry = store.registry()
      const edge = { parentId: parentId!, childId: childId!, role: 'WHEN' as const }
      const batch = canonicalizeText('new-parent IS fact\nnew-child IS condition', store.registry())
      const indexed = { parent: 0, child: 1, role: 'WHEN' as const }
      const unchanged = () => {
        assert.equal(store.exportText({ tx: true }), before)
        assert.equal(store.registry(), registry)
        assert.deepEqual(store.edgesOf(parentId!), [])
      }
      for (const role of ['BOGUS', 'when', '', 'WHEN\ninjected IS fact', null, 1]) {
        assert.throws(() => store.appendEdges([edge, { ...edge, role: role as never }]),
          { name: 'TypeError', message: /CAVE edge role/ })
        unchanged()
        assert.throws(() => store.insertResult({ ...batch, edges: [indexed, { ...indexed, role: role as never }] }),
          { name: 'TypeError', message: /CAVE edge role/ })
        unchanged()
      }
      for (const field of ['parent', 'child'] as const) for (const index of [-1, 2, 0.5, NaN, Infinity, '0', null]) {
        assert.throws(() => store.insertResult({ ...batch, edges: [indexed, { ...indexed, [field]: index } as never] }),
          { name: 'TypeError', message: new RegExp(`CAVE edge ${field}.*existing claim`) })
        unchanged()
      }
      store.appendEdges([edge])
      assert.equal(store.edgesOf(parentId!).length, 1)
      assert.equal(store.insertResult({ ...batch, edges: [indexed] }).edges, 1)
    } finally { store.close() }
  })

  test(`${adapter.name}: export rejects invalid stored edge roles within its sensitivity scope`, () => {
    const store = openWith(adapter)
    try {
      const { ids } = store.ingest('parent IS fact #sensitivity:public\nchild IS condition #sensitivity:restricted')
      const snapshot = () => JSON.stringify(store.db.prepare('SELECT * FROM cave_edge').all())
      for (const role of ['BOGUS', 'when', '', 'WHEN\ninjected IS fact']) {
        store.db.prepare('DELETE FROM cave_edge').run()
        store.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)').run(ids[0]!, role, ids[1]!)
        const before = snapshot()
        for (const current of [false, true]) for (const tx of [false, true]) {
          const visible = store.exportText({ current, tx, maxSensitivity: 'public' })
          assert.match(visible, /parent IS fact/)
          assert.ok(!visible.includes(ids[1]!))
          assert.throws(() => store.exportText({ current, tx, maxSensitivity: 'restricted' }), error => {
            assert.ok(error instanceof Error)
            assert.match(error.message, /stored edge role/)
            assert.ok(error.message.includes(ids[0]!))
            assert.ok(error.message.includes(ids[1]!))
            return true
          })
          assert.equal(snapshot(), before)
        }
      }
      store.db.prepare('UPDATE cave_edge SET role = ?').run('WHEN')
      assert.match(store.exportText({ maxSensitivity: 'restricted' }), /WHEN child IS condition/)
    } finally { store.close() }
  })

  for (const endpoint of ['parent_id', 'child_id'] as const) {
    test(`${adapter.name}: export rejects a missing ${endpoint} when the surviving endpoint is included`, () => {
      const store = openWith(adapter)
      try {
        store.ingest('visible IS retained #sensitivity:public\nprivate-parent EXISTS #sensitivity:restricted\n  WHEN private-condition EXISTS #sensitivity:restricted')
        const edge = store.db.prepare('SELECT * FROM cave_edge').get() as { parent_id: string, child_id: string }
        store.ingest('private-parent EXISTS @ 80% #sensitivity:restricted\nprivate-condition EXISTS @ 70% #sensitivity:restricted')
        const original = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        const missing = '01900000-0000-7000-8000-000000000000'
        store.db.exec('PRAGMA foreign_keys = OFF')
        store.db.prepare(`UPDATE cave_edge SET ${endpoint} = ?`).run(missing)
        store.db.exec('PRAGMA foreign_keys = ON')
        const snapshot = () => JSON.stringify(['cave_claim', 'cave_edge', 'cave_tag', 'cave_context']
          .map(table => store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
        const before = snapshot()
        for (const current of [false, true]) for (const tx of [false, true]) {
          assert.match(store.exportText({ current, tx, maxSensitivity: 'public' }), /visible IS retained/)
          assert.throws(() => store.exportText({ current, tx, maxSensitivity: 'restricted' }), error => {
            assert.ok(error instanceof Error)
            assert.match(error.message, /edge.*missing claim/)
            assert.doesNotMatch(error.message, /private/)
            return true
          })
          assert.equal(snapshot(), before)
        }
        store.db.prepare(`UPDATE cave_edge SET ${endpoint} = ?`).run(edge[endpoint]!)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), original)
      } finally { store.close() }
    })
  }

  test(`${adapter.name}: historical boolean flags reject non-binary values without coercion`, () => {
    const store = openWith(adapter)
    try {
      const id = store.ingest('subject IS object').ids[0]!
      for (const field of ['negated', 'importance'] as const) {
        for (const invalid of [-1, 2, 0.5, 'false']) {
          store.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run(invalid, id)
          const before = JSON.stringify(store.db.prepare('SELECT * FROM cave_claim').all())
          assert.throws(() => store.toClaim(store.currentBeliefs()[0]!), new RegExp(`stored claim ${field}.*0 or 1`))
          assert.throws(() => store.exportText(), error => {
            assert.ok(error instanceof Error)
            assert.ok(error.message.includes(id))
            assert.match(error.message, new RegExp(field))
            return true
          })
          assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM cave_claim').all()), before)
        }
        for (const valid of [1, 0]) {
          store.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run(valid, id)
          assert.equal(store.toClaim(store.currentBeliefs()[0]!)[field], valid === 1)
          assert.doesNotThrow(() => store.exportText())
        }
      }
    } finally { store.close() }
  })

  test(`${adapter.name}: historical approximation flags reject non-binary values and recover after repair`, () => {
    const store = openWith(adapter)
    try {
      const id = store.ingest('sample HAS score: ~42').ids[0]!
      for (const invalid of [-1, 2, 0.5, 'false']) {
        store.db.prepare('UPDATE cave_claim SET value_approx = ? WHERE id = ?').run(invalid, id)
        const before = JSON.stringify(store.db.prepare('SELECT * FROM cave_claim').all())
        assert.throws(() => store.toClaim(store.currentBeliefs()[0]!), /stored claim value_approx.*0 or 1/)
        assert.throws(() => store.exportText(), error => {
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes(id))
          assert.match(error.message, /value_approx/)
          return true
        })
        assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM cave_claim').all()), before)
      }
      store.db.prepare('UPDATE cave_claim SET value_approx = 1 WHERE id = ?').run(id)
      const claim = store.toClaim(store.currentBeliefs()[0]!)
      assert.ok(claim.payload.kind === 'attribute')
      assert.equal(claim.payload.value.approx, true)
      assert.doesNotThrow(() => store.exportText())
    } finally { store.close() }
  })

  test(`${adapter.name}: cached numeric columns must agree with authored values before export`, () => {
    const store = openWith(adapter)
    try {
      const id = store.ingest('sample HAS revenue: ~20B USD/yr +/- 2B USD/yr').ids[0]!
      const original = store.currentBeliefs()[0]!
      for (const [field, invalid] of [
        ['value_num', 21], ['value_num', null], ['value_unit', 'EUR/yr'],
        ['value_unit', null], ['value_approx', 0], ['delta_num', 3],
        ['delta_num', null], ['delta_unit', 'EUR/yr'], ['delta_unit', null]
      ] as const) {
        store.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run(invalid, id)
        const before = JSON.stringify(store.db.prepare('SELECT * FROM cave_claim').all())
        assert.throws(() => store.toClaim(store.currentBeliefs()[0]!), new RegExp(`stored claim ${field}.*authored value`))
        assert.throws(() => store.exportText(), error => {
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes(id))
          assert.ok(error.message.includes(field))
          return true
        })
        assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM cave_claim').all()), before)
        store.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run(original[field], id)
        assert.doesNotThrow(() => store.exportText())
      }
    } finally { store.close() }
  })

  test(`${adapter.name}: invalid access modes fail before opening the adapter`, () => {
    let opens = 0, coercions = 0
    const tracked: Adapter = { ...adapter, open: (path, options) => {
      opens++
      return adapter.open(path, options)
    } }
    for (const access of ['', 'readonly', 'READ-ONLY', 'write', null, 1, true, 1n, Symbol('access'),
      { [Symbol.toPrimitive]() { coercions++; return 'read-only' } }]) {
      assert.throws(() => {
        const store = openWith(tracked, ':memory:', { access: access as never })
        store.close()
      }, error => error instanceof TypeError && /access.*read-only.*no-migrate.*migrate/.test(error.message))
      assert.equal(opens, 0)
      assert.equal(coercions, 0)
    }
    const recovered = openWith(tracked, ':memory:', { access: 'migrate' })
    try {
      assert.equal(opens, 1)
      assert.equal(recovered.ingest('recovered IS ready').ids.length, 1)
    } finally { recovered.close() }
  })

  test(`${adapter.name}: current and historical vocabulary share captured open options`, () => {
    const first = Registry.declareVerb(Registry.empty, 'FIRST')
    const second = Registry.declareVerb(Registry.empty, 'SECOND')
    let reads = 0, accessReads = 0
    const store = openWith(adapter, ':memory:', {
      get registry() { return ++reads === 1 ? first : second },
      get access(): 'migrate' { accessReads++; return 'migrate' }
    })
    try {
      assert.equal(store.baseRegistry(), first)
      assert.deepEqual(store.registry(), first)
      assert.deepEqual(store.registryAsOf('2026-01-01'), first)
      store.reloadRegistry()
      assert.deepEqual(store.registry(), first)
      assert.equal(reads, 1)
      assert.equal(accessReads, 1)
    } finally { store.close() }
  })

  for (const phase of ['pragma', 'schema', 'statement', 'vocabulary']) for (const closeFails of [false, true]) {
    test(`${adapter.name}: failed ${phase} startup closes its database (close failure=${closeFails})`, () => {
      const failure = new Error(`${phase} startup interrupted`), closeFailure = new Error('startup close interrupted')
      let active = true, closes = 0
      const cleanup: (() => void)[] = []
      const faulty: Adapter = { ...adapter, open: (path, options) => {
        const db = adapter.open(path, options)
        let closed = false
        cleanup.push(() => { if (!closed) db.close() })
        return {
          exec: sql => {
            if (active && phase === 'pragma' && sql.includes('busy_timeout')) throw failure
            db.exec(sql)
          },
          prepare: sql => {
            if (active && (phase === 'schema' && sql === 'PRAGMA user_version' ||
              phase === 'statement' && sql === 'SELECT MAX(tx) AS tx FROM cave_claim' ||
              phase === 'vocabulary' && sql.includes('SELECT subject, verb, object FROM cave_claim'))) throw failure
            return db.prepare(sql)
          },
          close: () => {
            closes++
            db.close()
            closed = true
            if (active && closeFails) throw closeFailure
          }
        }
      } }
      try {
        assert.throws(() => openWith(faulty), error => {
          if (!closeFails) return error === failure
          assert.ok(error instanceof AggregateError)
          assert.deepEqual(error.errors, [failure, closeFailure])
          assert.equal(error.cause, failure)
          assert.ok(error.message.includes(failure.message))
          assert.ok(error.message.includes(closeFailure.message))
          return true
        })
        assert.equal(closes, 1)
        active = false
        const retry = openWith(faulty)
        try { retry.ingest('retry IS ready'); assert.equal(retry.currentBeliefs().length, 1) }
        finally { retry.close() }
        assert.equal(closes, 2)
      } finally { for (const close of cleanup) close() }
    })
  }

  test(`${adapter.name}: record publication rejects stored keys inconsistent with claim contexts`, () => {
    for (const mutation of ['key', 'context']) {
      const store = openWith(adapter)
      try {
        store.ingest('private-subject IS retained @src:inventory #team:core')
        const row = store.currentBeliefs()[0]!
        assert.deepEqual(ClaimRecord.decode(ClaimRecord.encode(store.recordOf(row))), store.recordOf(row))
        if (mutation === 'key') {
          store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run('private-key', row.id)
        } else {
          store.db.prepare('INSERT INTO cave_context (claim_id, context) VALUES (?, ?)').run(row.id, 'private-context')
        }
        const snapshot = () => JSON.stringify({
          claims: store.db.prepare('SELECT * FROM cave_claim').all(),
          contexts: store.db.prepare('SELECT * FROM cave_context ORDER BY context').all()
        })
        const before = snapshot()
        assert.throws(() => store.recordOf(store.currentBeliefs()[0]!), error => {
          assert.ok(error instanceof Error)
          assert.match(error.message, /semantic identity/)
          assert.doesNotMatch(error.message, /private/)
          return true
        })
        assert.equal(snapshot(), before)
        if (mutation === 'key') {
          store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(row.claim_key, row.id)
        } else {
          store.db.prepare('DELETE FROM cave_context WHERE claim_id = ? AND context = ?').run(row.id, 'private-context')
        }
        const record = store.recordOf(store.currentBeliefs()[0]!)
        assert.deepEqual(ClaimRecord.decode(ClaimRecord.encode(record)), record)
      } finally { store.close() }
    }
  })

  test(`${adapter.name}: record publication rejects empty stored provenance and recovers`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('api IS service')
      const row = store.currentBeliefs()[0]!
      store.db.prepare("INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, 'source', '')").run(row.id)
      const before = store.db.prepare('SELECT * FROM cave_provenance').all()
      assert.throws(() => store.recordOf(row), /malformed.*provenance/)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_provenance').all(), before)
      store.db.prepare("DELETE FROM cave_provenance WHERE claim_id = ? AND value = ''").run(row.id)
      const record = store.recordOf(row)
      assert.deepEqual(ClaimRecord.decode(ClaimRecord.encode(record)), record)
    } finally { store.close() }
  })

  test(`${adapter.name}: record publication rejects malformed stored transaction identity and recovers`, () => {
    const store = openWith(adapter)
    try {
      const id = store.ingest('private-subject IS retained').ids[0]!
      for (const tx of ['018f0000-0000-7000-8000-000000000002',
        '018F0000-0000-7000-8000-000000000002', 'private-invalid-tx']) {
        store.db.prepare('UPDATE cave_claim SET tx = ? WHERE id = ?').run(tx, id)
        const before = JSON.stringify(store.db.prepare('SELECT * FROM cave_claim').all())
        assert.throws(() => store.recordOf(store.currentBeliefs()[0]!), error => {
          assert.ok(error instanceof Error)
          assert.match(error.message, /transaction identity/)
          assert.doesNotMatch(error.message, /private/)
          return true
        })
        assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM cave_claim').all()), before)
        store.db.prepare('UPDATE cave_claim SET tx = ? WHERE id = ?').run(id, id)
        const record = store.recordOf(store.currentBeliefs()[0]!)
        assert.deepEqual(ClaimRecord.decode(ClaimRecord.encode(record)), record)
      }
    } finally { store.close() }
  })

  test(`${adapter.name}: annotated export rejects malformed row identities within its sensitivity scope`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('visible IS retained #sensitivity:public\nprivate-subject IS retained #sensitivity:restricted')
      const row = store.currentBeliefs().find(row => row.subject === 'private-subject')!
      const publicText = store.exportText({ tx: true, maxSensitivity: 'public' })
      const plainText = store.exportText({ maxSensitivity: 'restricted' })
      for (const invalid of ['018f0000-0000-7000-8000-000000000002',
        '018F0000-0000-7000-8000-000000000002', 'private-invalid-tx']) {
        store.db.prepare('UPDATE cave_claim SET tx = ? WHERE id = ?').run(invalid, row.id)
        const before = JSON.stringify(store.db.prepare('SELECT * FROM cave_claim ORDER BY id').all())
        for (const current of [false, true]) {
          assert.equal(store.exportText({ current, tx: true, maxSensitivity: 'public' }), publicText)
          assert.throws(() => store.exportText({ current, tx: true, maxSensitivity: 'restricted' }), error => {
            assert.ok(error instanceof Error)
            assert.ok(error.message.includes(row.id))
            assert.match(error.message, /transaction identity/)
            assert.doesNotMatch(error.message, /private/)
            assert.ok(error.cause instanceof Error)
            return true
          })
        }
        assert.equal(store.exportText({ maxSensitivity: 'restricted' }).split('\n').sort().join('\n'), plainText.split('\n').sort().join('\n'))
        assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM cave_claim ORDER BY id').all()), before)
        store.db.prepare('UPDATE cave_claim SET tx = ? WHERE id = ?').run(row.id, row.id)
        assert.ok(store.exportText({ tx: true, maxSensitivity: 'restricted' }).includes(row.id))
      }
    } finally { store.close() }
  })

  test(`${adapter.name}: schema validation requires claim and provenance primary keys`, () => {
    const ddl = Schema.ddl.replace('USING fts5(', `USING ${adapter.capabilities.fullText}(`)
    for (const table of ['cave_claim', 'cave_provenance']) {
      const db = adapter.open(':memory:')
      try {
        const malformed = table === 'cave_claim'
          ? ddl.replace('id            TEXT PRIMARY KEY', 'id            TEXT')
          : ddl.replace('PRIMARY KEY (claim_id, dimension, value),', '')
        db.exec(malformed)
        db.exec(`PRAGMA user_version = ${Schema.currentVersion}`)
        const before = JSON.stringify(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all())
        for (const check of [() => Schema.check(db), () => Schema.init(db, adapter.capabilities)]) {
          assert.throws(check, new RegExp(`incompatible table ${table}: expected primary key`))
          assert.equal(JSON.stringify(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all()), before)
        }
        db.exec(`DROP TABLE ${table}`)
        db.exec(ddl)
        assert.doesNotThrow(() => Schema.check(db))
      } finally { db.close() }
    }
  })

  test(`${adapter.name}: identity primary keys retain binary comparison semantics`, () => {
    const ddl = Schema.ddl.replace('USING fts5(', `USING ${adapter.capabilities.fullText}(`)
    for (const collation of ['NOCASE', 'RTRIM']) {
      for (const column of ['id', 'claim_id', 'dimension', 'value']) {
        const table = column === 'id' ? 'cave_claim' : 'cave_provenance'
        const db = adapter.open(':memory:')
        try {
          const malformed = column === 'id'
            ? ddl.replace('id            TEXT PRIMARY KEY', `id            TEXT COLLATE ${collation} PRIMARY KEY`)
            : ddl.replace('PRIMARY KEY (claim_id, dimension, value)',
              `PRIMARY KEY (${['claim_id', 'dimension', 'value'].map(name =>
                name === column ? `${name} COLLATE ${collation}` : name).join(', ')})`)
          db.exec(malformed)
          db.exec(`PRAGMA user_version = ${Schema.currentVersion}`)
          const before = JSON.stringify(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all())
          for (const check of [() => Schema.check(db), () => Schema.init(db, adapter.capabilities)]) {
            assert.throws(check, new RegExp(`incompatible table ${table}: expected primary key.*BINARY`))
            assert.equal(JSON.stringify(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all()), before)
          }
          db.exec(`DROP TABLE ${table}`)
          db.exec(ddl)
          assert.doesNotThrow(() => Schema.check(db))
          db.exec("INSERT INTO cave_claim (id, tx, subject, verb, raw_line, claim_key) VALUES ('id', 'id', 'api', 'EXISTS', 'api EXISTS', 'key')")
          const put = db.prepare('INSERT OR IGNORE INTO cave_provenance VALUES (?, ?, ?)')
          for (const value of ['Manual', 'manual', 'manual ']) put.run('id', 'source', value)
          assert.deepEqual(db.prepare('SELECT value FROM cave_provenance ORDER BY value').all().map(row => row.value),
            ['Manual', 'manual', 'manual '])
        } finally { db.close() }
      }
    }
  })

  test(`${adapter.name}: text column affinity preserves authored values and provenance identities`, () => {
    const ddl = Schema.ddl.replace('USING fts5(', `USING ${adapter.capabilities.fullText}(`)
    for (const [table, column] of [
      ['cave_claim', 'subject'], ['cave_context', 'context'],
      ['cave_provenance', 'value'], ['cave_tag', 'value'], ['cave_edge', 'role']
    ]) {
      for (const type of ['NUMERIC', 'INTEGER', 'REAL', 'BLOB', 'STRING', 'CHARINT', '']) {
        const db = adapter.open(':memory:')
        try {
          const start = ddl.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)
          const end = ddl.indexOf(');', start)
          const declaration = ddl.slice(start, end)
          const changed = declaration.replace(new RegExp(`(\\b${column}\\s+)TEXT\\b`), `$1${type}`)
          assert.notEqual(changed, declaration)
          db.exec(ddl.slice(0, start) + changed + ddl.slice(end))
          db.exec(`PRAGMA user_version = ${Schema.currentVersion}`)
          const before = JSON.stringify(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all())
          for (const check of [() => Schema.check(db), () => Schema.init(db, adapter.capabilities)]) {
            assert.throws(check, new RegExp(`incompatible column ${table}\\.${column}: expected TEXT affinity`))
            assert.equal(JSON.stringify(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all()), before)
          }
          db.exec(`DROP TABLE ${table}`)
          db.exec(ddl)
          assert.doesNotThrow(() => Schema.check(db))
        } finally { db.close() }
      }
    }
    for (const type of ['TEXT', 'VARCHAR(255)', 'CLOB']) {
      const db = adapter.open(':memory:')
      try {
        db.exec(ddl.replace(/\bTEXT\b/g, type))
        db.exec(`PRAGMA user_version = ${Schema.currentVersion}`)
        assert.doesNotThrow(() => Schema.check(db))
        db.exec("INSERT INTO cave_claim (id, tx, subject, verb, raw_line, claim_key) VALUES ('id', 'id', 'api', 'EXISTS', 'api EXISTS', 'key')")
        const put = db.prepare('INSERT OR IGNORE INTO cave_provenance VALUES (?, ?, ?)')
        for (const value of ['001', '1', '1.0', '1e0']) put.run('id', 'source', value)
        assert.deepEqual(db.prepare('SELECT value FROM cave_provenance ORDER BY value').all().map(row => row.value),
          ['001', '1', '1.0', '1e0'])
      } finally { db.close() }
    }
  })

  test(`${adapter.name}: numeric column affinity preserves range comparisons`, () => {
    const ddl = Schema.ddl.replace('USING fts5(', `USING ${adapter.capabilities.fullText}(`)
    for (const column of ['negated', 'value_num', 'value_approx', 'delta_num', 'sigma_level', 'conf', 'importance']) {
      for (const type of ['TEXT', 'VARCHAR(255)', 'BLOB', '']) {
        const db = adapter.open(':memory:')
        try {
          const changed = ddl.replace(new RegExp(`(\\b${column}\\s+)(?:REAL|INTEGER)\\b`), `$1${type}`)
          assert.notEqual(changed, ddl)
          db.exec(changed)
          db.exec(`PRAGMA user_version = ${Schema.currentVersion}`)
          const before = JSON.stringify(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all())
          for (const check of [() => Schema.check(db), () => Schema.init(db, adapter.capabilities)]) {
            assert.throws(check, new RegExp(`incompatible column cave_claim\\.${column}: expected numeric affinity`))
            assert.equal(JSON.stringify(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all()), before)
          }
          db.exec('DROP TABLE cave_claim')
          db.exec(ddl)
          assert.doesNotThrow(() => Schema.check(db))
        } finally { db.close() }
      }
    }
    for (const type of ['REAL', 'INTEGER', 'NUMERIC', 'DOUBLE PRECISION', 'CHARINT']) {
      const db = adapter.open(':memory:')
      try {
        db.exec(ddl.replace('value_num     REAL', `value_num     ${type}`))
        db.exec(`PRAGMA user_version = ${Schema.currentVersion}`)
        assert.doesNotThrow(() => Schema.check(db))
        const put = db.prepare('INSERT INTO cave_claim(id,tx,subject,verb,raw_line,claim_key,value_num) VALUES(?,?,?,?,?,?,?)')
        for (const value of [2, 3.5, 10]) put.run(String(value), String(value), 'api', 'HAS', `api HAS count: ${value}`, String(value), value)
        for (const threshold of [3, '3']) {
          assert.deepEqual(db.prepare('SELECT value_num FROM cave_claim WHERE value_num > ? ORDER BY value_num').all(threshold).map(row => row.value_num), [3.5, 10])
        }
      } finally { db.close() }
    }
  })

  test(`${adapter.name}: strict numeric declarations preserve fractional writes`, () => {
    const ddl = Schema.ddl.replace('USING fts5(', `USING ${adapter.capabilities.fullText}(`)
    const end = ddl.indexOf(');')
    const strict = ddl.slice(0, end) + ') STRICT;' + ddl.slice(end + 2)
    for (const column of ['value_num', 'delta_num', 'sigma_level', 'conf', 'negated', 'value_approx', 'importance']) {
      const fractional = ['value_num', 'delta_num', 'sigma_level', 'conf'].includes(column)
      for (const type of fractional ? ['INTEGER', 'INT', 'ANY'] : ['ANY']) {
        const db = adapter.open(':memory:')
        try {
          db.exec(strict.replace(new RegExp(`(\\b${column}\\s+)(?:REAL|INTEGER)\\b`), `$1${type}`))
          db.exec(`PRAGMA user_version = ${Schema.currentVersion}`)
          const before = JSON.stringify(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all())
          for (const check of [() => Schema.check(db), () => Schema.init(db, adapter.capabilities)]) {
            assert.throws(check, new RegExp(`incompatible column cave_claim\\.${column}:`))
            assert.equal(JSON.stringify(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all()), before)
          }
          db.exec('DROP TABLE cave_claim')
          db.exec(strict)
          assert.doesNotThrow(() => Schema.check(db))
          db.prepare('INSERT INTO cave_claim(id,tx,subject,verb,raw_line,claim_key,value_num,delta_num,sigma_level,conf) VALUES(?,?,?,?,?,?,?,?,?,?)')
            .run('id', 'id', 'api', 'HAS', 'api HAS count: 3.5', 'key', 3.5, 0.25, 1.5, 0.75)
          const row = db.prepare('SELECT value_num,delta_num,sigma_level,conf FROM cave_claim').get()!
          assert.deepEqual([row.value_num, row.delta_num, row.sigma_level, row.conf], [3.5, 0.25, 1.5, 0.75])
        } finally { db.close() }
      }
    }
  })

  test(`${adapter.name}: schema validation rejects a view substituted for a required table`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('api IS service')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const ddl = store.db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'cave_fts'").get()!.sql
      assert.equal(typeof ddl, 'string')
      assert.doesNotThrow(() => Schema.check(store.db))
      store.db.exec('DROP TABLE cave_fts')
      const projection = 'id AS claim_id, subject, verb, object, attribute, value_text, comment, raw_line'
      store.db.exec(`CREATE VIEW cave_fts AS SELECT ${projection} FROM cave_claim`)
      const schema = JSON.stringify(store.db.prepare('SELECT * FROM sqlite_schema').all())
      for (const validate of [() => Schema.check(store.db), () => Schema.init(store.db, adapter.capabilities)]) {
        assert.throws(validate, /missing table cave_fts/)
        assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM sqlite_schema').all()), schema)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      store.db.exec('DROP VIEW cave_fts')
      store.db.exec(ddl as string)
      store.db.exec(`INSERT INTO cave_fts SELECT ${projection} FROM cave_claim`)
      assert.doesNotThrow(() => Schema.check(store.db))
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  })

  test(`${adapter.name}: schema validation rejects an ordinary table substituted for the search index`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('api IS service')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const ddl = store.db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'cave_fts'").get()!.sql
      const projection = 'id AS claim_id, subject, verb, object, attribute, value_text, comment, raw_line'
      store.db.exec('DROP TABLE cave_fts')
      store.db.exec(`CREATE TABLE cave_fts AS SELECT ${projection} FROM cave_claim`)
      const schema = JSON.stringify(store.db.prepare('SELECT * FROM sqlite_schema').all())
      for (const validate of [() => Schema.check(store.db), () => Schema.init(store.db, adapter.capabilities)]) {
        assert.throws(validate, /cave_fts.*virtual table/)
        assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM sqlite_schema').all()), schema)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      store.db.exec('DROP TABLE cave_fts')
      store.db.exec(ddl as string)
      store.db.exec(`INSERT INTO cave_fts SELECT ${projection} FROM cave_claim`)
      assert.doesNotThrow(() => Schema.check(store.db))
      assert.equal(store.search('service').length, 1)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  })

  test(`${adapter.name}: transaction index migration rolls back and retries without changing claims`, t => {
    const store = openWith(adapter, ':memory:')
    try {
      store.ingest('api HAS owner: platform @src:inventory #team:core\n  WHEN review IS complete')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      store.db.exec('DROP INDEX idx_cave_tx')
      store.db.exec('PRAGMA user_version = 1')
      assert.doesNotThrow(() => Schema.validate(store.db, 1))
      assert.throws(() => Schema.check(store.db), /needs migration to 2/)
      const exec = store.db.exec.bind(store.db)
      const mock = t.mock.method(store.db, 'exec', (sql: string) => {
        exec(sql)
        if (sql.startsWith('CREATE INDEX IF NOT EXISTS idx_cave_tx')) throw new Error('interrupted index migration')
      })
      assert.throws(() => Schema.init(store.db, adapter.capabilities), /schema migration 1 -> 2 failed/)
      mock.mock.restore()
      assert.equal(Schema.versionOf(store.db), 1)
      assert.equal(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_cave_tx'").get(), undefined)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      store.db.exec('CREATE INDEX idx_cave_tx ON cave_claim(claim_key)')
      assert.throws(() => Schema.init(store.db, adapter.capabilities), /incompatible index idx_cave_tx/)
      assert.equal(Schema.versionOf(store.db), 1)
      store.db.exec('DROP INDEX idx_cave_tx')
      Schema.init(store.db, adapter.capabilities)
      assert.equal(Schema.versionOf(store.db), 2)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      for (const sql of ['SELECT MAX(tx) FROM cave_claim', "SELECT MAX(tx) FROM cave_claim WHERE tx <= 'ffffffff-ffff-7fff-bfff-ffffffffffff'"]) {
        const plan = store.db.prepare('EXPLAIN QUERY PLAN ' + sql).all()
        assert.ok(plan.some(row => String(row.detail).includes('idx_cave_tx')))
        if (sql.includes('WHERE')) assert.ok(plan.some(row => String(row.detail).includes('(tx<?)')))
      }
      store.db.exec('DROP INDEX idx_cave_tx')
      assert.throws(() => Schema.validate(store.db, 2), /missing index idx_cave_tx/)
    } finally { store.close() }
  })

  test(`${adapter.name}: legacy migration preserves large provenance sets and context-free claims`, () => {
    const store = openWith(adapter, ':memory:')
    try {
      const sources = Array.from({ length: 5_000 }, (_, index) => `source-${index}`)
      store.ingest('bare IS item\napi USES postgres ' + sources.map(source => `@src:${source}`).join(' '), { strict: true })
      const before = store.currentBeliefs()
      store.db.exec('DROP TABLE cave_provenance; PRAGMA user_version = 0')
      Schema.init(store.db, adapter.capabilities)
      assert.equal(Schema.versionOf(store.db), Schema.currentVersion)
      assert.deepEqual(store.currentBeliefs(), before, 'migration preserves claim identities and content')
      assert.deepEqual(new Set(store.provenanceOf(before.find(row => row.subject === 'api')!).sources), new Set(sources))
      assert.deepEqual(store.provenanceOf(before.find(row => row.subject === 'bare')!),
        { actors: [], sources: [], runs: [], domains: [] })
      const migrated = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      Schema.init(store.db, adapter.capabilities)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), migrated)
    } finally { store.close() }
  })

  test(`${adapter.name}: required index definitions preserve ordinary writes and lookup semantics`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('api IS service')
      const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      for (const [name, definition] of [
        ['idx_cave_subject', 'CREATE UNIQUE INDEX idx_cave_subject ON cave_claim(subject)'],
        ['idx_cave_verb', 'CREATE INDEX idx_cave_verb ON cave_context(context)'],
        ['idx_cave_object', 'CREATE INDEX idx_cave_object ON cave_claim(object COLLATE NOCASE)'],
        ['idx_cave_attribute', "CREATE INDEX idx_cave_attribute ON cave_claim(attribute) WHERE attribute IS NOT NULL"],
        ['idx_cave_claim_key_tx', 'CREATE INDEX idx_cave_claim_key_tx ON cave_claim(tx, claim_key)'],
        ['idx_cave_provenance_lookup', 'CREATE INDEX idx_cave_provenance_lookup ON cave_provenance(lower(dimension), value, claim_id)'],
        ['idx_cave_tag_claim', 'CREATE INDEX idx_cave_tag_claim ON cave_tag(claim_id, key, value, claim_id)']
      ]) {
        store.db.exec(`DROP INDEX ${name}`)
        store.db.exec(definition!)
        const schema = JSON.stringify(store.db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all())
        for (const check of [() => Schema.check(store.db), () => Schema.init(store.db, adapter.capabilities)]) {
          assert.throws(check, new RegExp(`incompatible index ${name}`))
          assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all()), schema)
          assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
        }
        store.db.exec(`DROP INDEX ${name}`)
        store.db.exec(Schema.ddl.replace('USING fts5(', `USING ${adapter.capabilities.fullText}(`))
        assert.doesNotThrow(() => Schema.check(store.db))
      }
      store.ingest('api HAS owner: alice')
      assert.equal(store.currentBeliefs().filter(row => row.subject === 'api').length, 2)
    } finally { store.close() }
  })

  test(`${adapter.name}: transaction index validation rejects incompatible collations and definitions`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('api IS service')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      for (const definition of [
        'cave_claim(tx COLLATE NOCASE)',
        'cave_claim(tx) WHERE subject = \'api\'',
        'cave_context(context)',
        'cave_claim(lower(tx))',
        'cave_claim(tx, claim_key)',
      ]) {
        store.db.exec('DROP INDEX idx_cave_tx')
        store.db.exec('CREATE INDEX idx_cave_tx ON ' + definition)
        assert.throws(() => Schema.check(store.db), /incompatible index idx_cave_tx/, definition)
        store.db.exec('PRAGMA user_version = 1')
        assert.throws(() => Schema.init(store.db, adapter.capabilities), /incompatible index idx_cave_tx/, definition)
        assert.equal(Schema.versionOf(store.db), 1)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        store.db.exec('DROP INDEX idx_cave_tx')
        Schema.init(store.db, adapter.capabilities)
        assert.equal(Schema.versionOf(store.db), 2)
      }
      store.db.exec('DROP INDEX idx_cave_tx')
      store.db.exec('CREATE INDEX idx_cave_tx ON cave_claim(tx COLLATE binary DESC)')
      assert.doesNotThrow(() => Schema.check(store.db))
      const plan = store.db.prepare("EXPLAIN QUERY PLAN SELECT MAX(tx) FROM cave_claim WHERE tx <= 'ffffffff-ffff-7fff-bfff-ffffffffffff'").all()
      assert.ok(plan.some(row => String(row.detail).includes('idx_cave_tx (tx<?)')))
    } finally { store.close() }
  })

  test(`${adapter.name}: interrupted registry reload retains the previous vocabulary and permits retry`, t => {
    const store = openWith(adapter)
    try {
      store.ingest('HOSTS IS verb\nHOSTS REVERSE HOSTED-BY\nfirst HOSTS api')
      const before = store.registry()
      const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const failure = new Error('registry declaration read interrupted')
      const prepare = store.db.prepare.bind(store.db)
      const interception = t.mock.method(store.db, 'prepare', (sql: string) => {
        if (sql.includes('SELECT subject, verb, object FROM cave_claim')) throw failure
        return prepare(sql)
      })
      assert.throws(() => store.reloadRegistry(), error => error === failure)
      interception.mock.restore()
      assert.equal(store.registry(), before)
      assert.equal(store.reverse('api')[0]!.rel, 'HOSTED-BY')
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
      store.reloadRegistry()
      assert.deepEqual(store.registry(), before)
      store.ingest('second HOSTS api')
      assert.equal(store.reverse('api').length, 2)
    } finally { store.close() }
  })

  test(`${adapter.name}: qualifier edges refresh vocabulary and roll back with their transaction`, () => {
    for (const role of ['WHEN', 'VIA', 'BECAUSE'] as const) {
      const store = openWith(adapter, ':memory:')
      try {
        const [declaration, parent] = store.ingest('CUSTOM IS verb\ndecision IS recorded').ids
        assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), true)
        const edges = [{ parentId: parent!, role, childId: declaration! }]
        assert.throws(() => store.transaction(() => {
          store.appendEdges(edges)
          assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), false, role)
          throw new Error('rollback qualifier')
        }), /rollback qualifier/)
        assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), true, 'rollback restores vocabulary')
        assert.equal(store.edgesOf(parent!).length, 0)
        store.appendEdges(edges)
        assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), false, role)
        const current = store.registry()
        store.reloadRegistry()
        assert.deepEqual(store.registry(), current, 'explicit reload must not change the registry')
      } finally { store.close() }
    }
  })

  test(`${adapter.name}: failed edge batches restore history and vocabulary before retry`, t => {
    for (const failure of ['foreign key', 'registry refresh']) {
      const store = openWith(adapter)
      try {
        const [declaration, parent] = store.ingest('CUSTOM IS verb\ndecision IS recorded').ids
        const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        const edge = { parentId: parent!, role: 'WHEN' as const, childId: declaration! }
        const refreshError = new Error('registry refresh interrupted')
        const prepare = store.db.prepare.bind(store.db)
        const interception = t.mock.method(store.db, 'prepare', (sql: string) => {
          if (failure === 'registry refresh' && sql.includes('SELECT subject, verb, object FROM cave_claim')) {
            throw refreshError
          }
          return prepare(sql)
        })
        if (failure === 'foreign key') {
          assert.throws(() => store.appendEdges([edge, { ...edge, childId: Uuidv7.next() }]), /FOREIGN KEY/i)
        } else {
          assert.throws(() => store.appendEdges([edge]), error => error === refreshError)
        }
        interception.mock.restore()
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        assert.deepEqual(store.edgesOf(parent!), [])
        assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), true)
        store.appendEdges([edge])
        assert.equal(store.edgesOf(parent!).length, 1)
        assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), false)
        const current = store.registry()
        store.reloadRegistry()
        assert.deepEqual(store.registry(), current)
      } finally { store.close() }
    }
  })

  test(`${adapter.name}: appended edges use captured fields for vocabulary refresh`, () => {
    for (const changed of ['role', 'childId']) {
      const store = openWith(adapter)
      try {
        const [declaration, parent] = store.ingest('CUSTOM IS verb\ndecision IS recorded').ids
        const reads = { parentId: 0, role: 0, childId: 0 }
        store.appendEdges([{
          get parentId() { reads.parentId++; return parent! },
          get role() { return ++reads.role === 1 || changed !== 'role' ? 'WHEN' : 'QUALIFIES' },
          get childId() { return ++reads.childId === 1 || changed !== 'childId' ? declaration! : parent! },
        }])
        assert.equal(store.edgesOf(parent!)[0]!.role, 'WHEN')
        assert.equal(store.edgesOf(parent!)[0]!.child.id, declaration)
        assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), false, changed)
        assert.deepEqual(reads, { parentId: 1, role: 1, childId: 1 })
        const current = store.registry()
        store.reloadRegistry()
        assert.deepEqual(store.registry(), current)
      } finally { store.close() }
    }
  })

  test(`${adapter.name}: result column names remain own data properties`, () => {
    const db = adapter.open(':memory:')
    try {
      const sql = 'SELECT 1 AS "__proto__", 2 AS constructor, 3 AS toString, 4 AS repeated, 5 AS repeated'
      const statement = db.prepare(sql)
      for (const row of [statement.get(), statement.all()[0]]) {
        assert.ok(row)
        assert.equal(Object.hasOwn(row, '__proto__'), true)
        assert.equal(row['__proto__'], 1)
        assert.equal(row['constructor'], 2)
        assert.equal(row['toString'], 3)
        assert.equal(row['repeated'], 5)
        assert.equal(JSON.parse(JSON.stringify(row))['__proto__'], 1)
      }
    } finally { db.close() }
  })

  test(`${adapter.name}: parameter reuse clears omitted bindings and recovers after binding failure`, () => {
    const db = adapter.open(':memory:')
    try {
      const select = db.prepare('SELECT ? AS first, ? AS second')
      assert.deepEqual({ ...select.get('first', 'second') }, { first: 'first', second: 'second' })
      assert.deepEqual({ ...select.get('replacement') }, { first: 'replacement', second: null })
      assert.deepEqual(select.all().map(row => ({ ...row })), [{ first: null, second: null }])
      assert.throws(() => select.get(1, 2, 3))
      assert.deepEqual({ ...select.get(4, 5) }, { first: 4, second: 5 })

      db.exec('CREATE TABLE parameter_results (value BLOB, label TEXT)')
      const insert = db.prepare('INSERT INTO parameter_results VALUES (?, ?)')
      insert.run(new Uint8Array(), 'empty')
      assert.throws(() => insert.run(new Uint8Array([99]), 'rejected', 'extra'))
      const bytes = new Uint8Array([0, 127, 128, 255])
      insert.run(bytes, 'bytes')
      bytes.fill(42)
      const rows = db.prepare('SELECT value, label, typeof(value) AS kind, length(value) AS size FROM parameter_results ORDER BY rowid').all()
      assert.equal(rows.length, 2, 'failed binding must not execute a partial write')
      assert.deepEqual(rows.map(row => [row['label'], row['kind'], row['size']]),
        [['empty', 'blob', 0], ['bytes', 'blob', 4]])
      assert.deepEqual(Array.from(rows[0]!['value'] as Uint8Array), [])
      assert.deepEqual(Array.from(rows[1]!['value'] as Uint8Array), [0, 127, 128, 255])
      insert.run(null)
      assert.deepEqual({ ...db.prepare('SELECT value, label FROM parameter_results ORDER BY rowid DESC').get() },
        { value: null, label: null })
    } finally { db.close() }
  })

  test(`${adapter.name}: declares the capabilities CAVE composes`, () => {
    assert.deepEqual(adapter.capabilities.transactions, { immediate: true, savepoints: true })
    assert.equal(adapter.capabilities.fullText, expectations.fullText)
    assert.equal(adapter.capabilities.backup !== undefined, expectations.backup)
    assert.equal(adapter.capabilities.loadExtension !== undefined, expectations.loadExtension)
  })

  test(`${adapter.name}: claim columns and semantic identity use one captured subject`, () => {
    const store = openWith(adapter)
    try {
      const original = canonicalizeText('api IS service', store.registry())
      let reads = 0
      const subject = { kind: 'entity' as const, get text() { return ++reads === 1 ? 'api' : 'worker' } }
      store.insertResult({ ...original, claims: [{ ...original.claims[0]!, claim: { ...original.claims[0]!.claim, subject } }] })
      const row = store.currentBeliefs()[0]!
      assert.equal(row.subject, 'api')
      assert.equal(reads, 1)
      assert.equal(row.claim_key, Key.of(original.claims[0]!.claim))
      assert.equal(store.exportText().trim(), 'api IS service')
    } finally { store.close() }
  })

  test(`${adapter.name}: numeric claim fields are captured before storage projections`, () => {
    const store = openWith(adapter)
    try {
      const original = canonicalizeText('api HAS count: 42', store.registry())
      const claim = original.claims[0]!.claim
      assert.equal(claim.payload.kind, 'attribute')
      if (claim.payload.kind !== 'attribute') return
      let reads = 0
      const value = { ...claim.payload.value, get num() { return ++reads === 1 ? 42 : 7 } }
      store.insertResult({ ...original, claims: [{ line: 1, claim: { ...claim,
        payload: { ...claim.payload, value } } }] })
      const row = store.currentBeliefs()[0]!
      assert.equal(reads, 1)
      assert.equal(row.value_num, 42)
      assert.equal(row.claim_key, Key.of(claim))
      assert.equal(store.exportText().trim(), 'api HAS count: 42')
    } finally { store.close() }
  })

  test(`${adapter.name}: append insertion uses the prepared claim batch`, () => {
    const store = openWith(adapter)
    try {
      const original = canonicalizeText('api IS service', store.registry())
      let reads = 0
      const result = store.insertResult({ ...original,
        get claims() { return ++reads === 1 ? original.claims : [] }
      })
      assert.equal(result.ids.length, 1)
      assert.equal(store.currentBeliefs().length, 1)
      assert.equal(reads, 1)
    } finally { store.close() }
  })

  test(`${adapter.name}: replay edge checks and insertion use the same captured role`, () => {
    const store = openWith(adapter)
    try {
      const original = canonicalizeText('api IS service\ncondition IS satisfied', store.registry())
      const ids = [Uuidv7.next(), Uuidv7.next()]
      let reads = 0
      const edge = { parent: 0, child: 1,
        get role(): 'WHEN' | 'QUALIFIES' { return ++reads === 1 ? 'WHEN' : 'QUALIFIES' } }
      const result = store.insertResult({ ...original, edges: [edge] }, { ids })
      assert.equal(result.edges, 1)
      assert.equal(reads, 1)
      assert.equal(store.db.prepare('SELECT role FROM cave_edge WHERE parent_id = ? AND child_id = ?').get(...ids)!.role, 'WHEN')
      const replay = store.insertResult({ ...original, edges: [{ parent: 0, child: 1, role: 'WHEN' }] }, { ids })
      assert.equal(replay.skipped, 2)
      assert.equal(replay.edges, 0)
    } finally { store.close() }
  })

  test(`${adapter.name}: explicit replay uses the same captured ID for validation and insertion`, () => {
    const store = openWith(adapter)
    try {
      const id = Uuidv7.next()
      let reads = 0
      const result = store.insertResult(canonicalizeText('api IS service', store.registry()), {
        get ids() { return ++reads === 1 ? [id] : ['not-a-uuid'] }
      })
      assert.deepEqual(result.ids, [id])
      assert.equal(reads, 1)
      assert.equal(store.currentBeliefs()[0]!.id, id)
      assert.doesNotThrow(() => store.exportText({ tx: true }))
    } finally { store.close() }
  })

  test(`${adapter.name}: append metadata getters are captured once for the whole batch`, () => {
    const store = openWith(adapter)
    try {
      let sourceReads = 0, provenanceReads = 0, actorReads = 0
      const result = store.ingest('api IS service\nworker IS service', {
        get source() { assert.equal(++sourceReads, 1); return 'agent/reviewer' },
        get provenance() {
          assert.equal(++provenanceReads, 1)
          return { get actor() { assert.equal(++actorReads, 1); return 'agent/owner' }, sources: ['manual'] }
        }
      })
      assert.equal(result.ids.length, 2)
      for (const id of result.ids) {
        const provenance = store.provenanceOf(id)
        assert.ok(provenance.actors.includes('agent/owner'))
        assert.ok(provenance.sources.includes('manual'))
      }
      assert.deepEqual([sourceReads, provenanceReads, actorReads], [1, 1, 1])
    } finally { store.close() }
  })

  test(`${adapter.name}: explicit replay validates IDs before insertion or observation`, () => {
    for (const invalid of ['', 'not-a-uuid', '01980000-0000-4000-8000-000000000000', '01980000-0000-7000-8000-00000000000A']) {
      Uuidv7.withStatePreserved(() => {
        const store = openWith(adapter)
        try {
          const future = Uuidv7.at(0xfffffffffffe, 0, new Uint8Array(8))
          const expected = Uuidv7.withStatePreserved(() => Uuidv7.next(() => 0).slice(0, 18))
          const before = store.registry()
          const result = canonicalizeText('CUSTOM IS verb\napi IS trusted', before)
          assert.throws(() => store.insertResult(result, { ids: [future, invalid] }), /claim 2.*lowercase UUIDv7/)
          assert.equal(store.currentBeliefs().length, 0)
          assert.equal(store.registry(), before)
          assert.equal(Uuidv7.next(() => 0).slice(0, 18), expected, 'a rejected batch does not advance the receive clock')
        } finally { store.close() }
      })
    }
  })

  test(`${adapter.name}: invalid Unicode replay preserves rows, vocabulary and receive clock`, () => {
    Uuidv7.withStatePreserved(() => {
      const store = openWith(adapter)
      try {
        const before = store.registry()
        const expected = Uuidv7.withStatePreserved(() => Uuidv7.next(() => 0).slice(0, 18))
        const ids = [0, 1].map(sequence => Uuidv7.at(0xfffffffffffe, sequence, new Uint8Array(8)))
        const result = canonicalizeText('CUSTOM IS verb\napi HAS label: "bad\ud800text"', before)
        assert.throws(() => store.insertResult(result, { ids }), /claim 2.*unpaired UTF-16 surrogate/)
        assert.equal(store.currentBeliefs().length, 0)
        assert.equal(store.registry(), before)
        assert.equal(Uuidv7.next(() => 0).slice(0, 18), expected)
        const valid = 'api HAS label: "café 😀\0tail"'
        store.ingest(valid)
        assert.ok(store.exportText().includes(valid))
      } finally { store.close() }
    })
  })

  test(`${adapter.name}: UUID failure rolls back a partial append and permits retry`, t => {
    Uuidv7.withStatePreserved(() => {
      const store = openWith(adapter)
      try {
        const committed = store.ingest('existing IS service').ids[0]!
        const registry = store.registry()
        const random = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
        let calls = 0
        const failure = t.mock.method(globalThis.crypto, 'getRandomValues', (value: Uint8Array) => {
          if (++calls === 2) throw new Error('randomness unavailable')
          return random(value)
        })
        try {
          assert.throws(() => store.ingest('CUSTOM IS verb\napi CUSTOM database'), /randomness unavailable/)
          assert.equal(calls, 2, 'the first row was allocated before failure')
        } finally { failure.mock.restore() }
        assert.deepEqual(store.currentBeliefs().map(row => row.id), [committed])
        assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get()?.['n'], 1)
        assert.equal(store.registry(), registry)
        assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), false)
        const retry = store.ingest('CUSTOM IS verb\napi CUSTOM database')
        assert.equal(retry.ids.length, 2)
        assert.ok(retry.ids.every(id => id > committed))
        assert.ok(retry.ids[1]! > retry.ids[0]!)
        assert.equal(store.currentBeliefs().length, 3)
        assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), true)
      } finally { store.close() }
    })
  })

  test(`${adapter.name}: cleanup subscriptions remain independent for the same callback`, () => {
    const store = openWith(adapter)
    let calls = 0
    const callback = () => { calls++ }
    const unsubscribe = store.onClose(callback)
    store.onClose(callback)
    store.onClose(callback)
    unsubscribe()
    unsubscribe()
    store.close()
    assert.equal(calls, 2, 'unsubscribing one registration leaves the other two intact')
    store.close()
    assert.equal(calls, 2)
  })

  test(`${adapter.name}: close runs dependent cleanup once and closes despite callback errors`, () => {
    const store = openWith(adapter)
    const calls: string[] = []
    const unsubscribe = store.onClose(() => calls.push('removed'))
    unsubscribe()
    store.onClose(() => {
      calls.push('first')
      assert.equal(store.db.prepare('SELECT 1 AS n').get()?.['n'], 1)
      throw new Error('first cleanup failed')
    })
    store.onClose(() => { calls.push('second'); throw new Error('second cleanup failed') })
    assert.throws(() => store.close(), (error: unknown) => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors.map(error => error.message), ['first cleanup failed', 'second cleanup failed'])
      assert.ok(error.message.includes('first cleanup failed'))
      assert.ok(error.message.includes('second cleanup failed'))
      return true
    })
    assert.deepEqual(calls, ['first', 'second'])
    assert.throws(() => store.db.prepare('SELECT 1').get())
    assert.doesNotThrow(() => store.close())
    assert.throws(() => store.onClose(() => undefined), /after close/)
  })

  test(`${adapter.name}: cleanup aggregation retains thrown values that cannot be formatted`, () => {
    const getterError = new Error('unreadable message')
    Object.defineProperty(getterError, 'message', { get: () => { throw new Error('message getter failed') } })
    for (const thrown of [Object.create(null), getterError]) {
      const store = openWith(adapter)
      const second = new Error('second cleanup failed')
      store.onClose(() => { throw thrown })
      store.onClose(() => { throw second })
      assert.throws(() => store.close(), error => {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.errors.length, 2)
        assert.equal(error.errors[0], thrown)
        assert.equal(error.errors[1], second)
        assert.ok(error.message.includes('[unprintable thrown value]'))
        assert.ok(error.message.includes(second.message))
        return true
      })
      assert.throws(() => store.db.prepare('SELECT 1'))
      assert.doesNotThrow(() => store.close())
    }
  })

  test(`${adapter.name}: asynchronous close callbacks fail explicitly without skipping cleanup`, async () => {
    let thenCalls = 0
    for (const makeResult of [
      () => Promise.resolve(),
      () => Promise.reject(new Error('async cleanup failure')),
      () => Object.defineProperty(Promise.reject(new Error('shadowed cleanup failure')), 'then', { value: null }),
      () => ({ then() { thenCalls++ } })
    ]) {
      const store = openWith(adapter)
      const calls: string[] = []
      store.onClose(() => { calls.push('async'); return makeResult() })
      store.onClose(() => { calls.push('sync'); assert.equal(store.db.prepare('SELECT 1 AS n').get()?.['n'], 1) })
      assert.throws(() => store.close(), /CAVE store cleanup callback must be synchronous/)
      assert.deepEqual(calls, ['async', 'sync'])
      assert.throws(() => store.db.prepare('SELECT 1'))
      assert.doesNotThrow(() => store.close())
      assert.deepEqual(calls, ['async', 'sync'])
    }
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(thenCalls, 0)
  })

  test(`${adapter.name}: a failed database close can be retried without repeating callbacks`, async t => {
    for (const asynchronous of [false, true]) {
      const store = openWith(adapter)
      let calls = 0, recoveryCalls = 0
      try {
        store.onClose(() => {
          calls++
          store.close()
          if (asynchronous) return Promise.reject(new Error('async cleanup failure'))
        })
        const closeError = new Error('database close failed')
        const failure = t.mock.method(store.db, 'close', () => { throw closeError })
        try {
          assert.throws(() => store.close(), error => {
            if (!asynchronous) return error === closeError
            assert.ok(error instanceof AggregateError)
            assert.equal(error.errors.length, 2)
            assert.ok(error.errors[0] instanceof TypeError)
            assert.match(error.errors[0].message, /cleanup callback must be synchronous/)
            assert.equal(error.errors[1], closeError)
            assert.match(error.message, /cleanup callback must be synchronous/)
            assert.match(error.message, /database close failed/)
            return true
          })
        } finally { failure.mock.restore() }
        assert.equal(store.db.prepare('SELECT 1 AS n').get()?.['n'], 1)
        store.onClose(() => { recoveryCalls++ })
        store.close()
        assert.equal(calls, 1)
        assert.equal(recoveryCalls, 1)
        assert.throws(() => store.db.prepare('SELECT 1').get())
        assert.doesNotThrow(() => store.close())
        assert.equal(recoveryCalls, 1)
        await new Promise(resolve => setTimeout(resolve, 0))
      } finally { store.close() }
    }
  })

  test(`${adapter.name}: epoch clipping composes with historical qualifier visibility`, () => {
    const store = openWith(adapter)
    try {
      const declaration = Uuidv7.at(0, 0, new Uint8Array(8))
      const parent = Uuidv7.at(1000, 0, new Uint8Array(8))
      store.insertResult(canonicalizeText('CUSTOM IS verb', store.registry()), { ids: [declaration] })
      store.insertResult(canonicalizeText('decision IS recorded', store.registry()), { ids: [parent] })
      store.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)')
        .run(parent, 'WHEN', declaration)
      assert.equal(Registry.isDeclared(store.registryAsOf('1969'), 'CUSTOM'), false)
      assert.equal(Registry.isDeclared(store.registryAsOf('1969-12-31T23:59:59.500Z'), 'CUSTOM'), true)
      assert.equal(Registry.isDeclared(store.registryAsOf(declaration), 'CUSTOM'), true)
      assert.equal(Registry.isDeclared(store.registryAsOf(parent), 'CUSTOM'), false)
      assert.equal(Registry.isDeclared(store.registryAsOf('1970-01-01'), 'CUSTOM'), false)
    } finally { store.close() }
  })

  test(`${adapter.name}: historical vocabulary bounds qualifier parents at the same date`, () => {
    Uuidv7.withStatePreserved(() => {
      const store = openWith(adapter)
      try {
        const stamp = (day: number, sequence: number) => Uuidv7.at(Date.UTC(2026, 0, day), sequence, new Uint8Array(8))
        const ids = [stamp(1, 0), stamp(1, 1), stamp(1, 2)]
        store.insertResult(canonicalizeText('LEADS IS verb\nLEADS REVERSE LED-BY\nLEADS RENAMED-TO GUIDES', store.registry()), { ids })
        const parent = stamp(2, 0)
        store.insertResult(canonicalizeText('decision IS recorded', store.registry()), { ids: [parent] })
        for (const id of ids) {
          store.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)').run(parent, 'WHEN', id)
        }
        const then = store.registryAsOf('2026-01-01')
        assert.equal(Registry.isDeclared(then, 'LEADS'), true)
        assert.equal(Registry.primaryOf(then, 'LED-BY').isInverse, true)
        assert.equal(Registry.isDeprecated(then, 'LEADS'), true)
        const later = store.registryAsOf(parent)
        assert.equal(Registry.isDeclared(later, 'LEADS'), false)
        assert.equal(Registry.primaryOf(later, 'LED-BY').isInverse, false)
        assert.equal(Registry.isDeprecated(later, 'LEADS'), false)
      } finally { store.close() }
    })
  })

  test(`${adapter.name}: supports SQL, nested transactions, and full-text search`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('api HAS owner: platform\napi HAS note: "adapter contract"', { strict: true })
      assert.equal(store.currentBeliefs().length, 2)
      assert.equal(store.search('adapter contract').length, 1)

      assert.throws(() => store.transaction(({ outermost }) => {
        assert.equal(outermost, true, 'this scope owns the eventual commit')
        store.ingest('api HAS state: outer')
        store.transaction(({ outermost }) => {
          assert.equal(outermost, false, 'a savepoint cannot commit caller-owned writes')
          store.ingest('api HAS state: inner')
        })
        throw new Error('rollback contract')
      }), /rollback contract/)
      assert.equal(store.currentBeliefs().length, 2)
      store.transaction(({ outermost }) => {
        assert.equal(outermost, true, 'rollback restores transaction ownership')
      })
    } finally {
      store.close()
    }
  })

  test(`${adapter.name}: deferred commit failure restores claims, vocabulary and transaction ownership`, () => {
    const store = openWith(adapter)
    try {
      store.db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE commit_parent (id INTEGER PRIMARY KEY);
        CREATE TABLE commit_child (parent_id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
      `)
      store.ingest('existing IS retained')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.throws(() => store.transaction(() => {
        store.ingest('CUSTOM IS verb\napi CUSTOM service', { strict: true })
        assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), true)
        store.db.prepare('INSERT INTO commit_child VALUES (?)').run(1)
      }), /FOREIGN KEY constraint failed/i)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), false)
      assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM commit_child').get()!.count, 0)
      store.transaction(({ outermost }) => {
        assert.equal(outermost, true)
        store.db.prepare('INSERT INTO commit_parent VALUES (?)').run(1)
        store.db.prepare('INSERT INTO commit_child VALUES (?)').run(1)
        store.ingest('CUSTOM IS verb\napi CUSTOM service', { strict: true })
      })
      assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), true)
      assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM commit_child').get()!.count, 1)
    } finally { store.close() }
  })

  test(`${adapter.name}: automatic rollback preserves original errors and restores vocabulary`, () => {
    for (const nested of [false, true]) {
      const store = openWith(adapter)
      try {
        store.db.exec('CREATE TABLE rollback_unique (value INTEGER UNIQUE); INSERT INTO rollback_unique VALUES (1)')
        store.ingest('existing IS retained')
        const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        const fail = () => {
          store.ingest('CUSTOM IS verb\napi CUSTOM service', { strict: true })
          store.db.exec('INSERT OR ROLLBACK INTO rollback_unique VALUES (1)')
        }
        assert.throws(() => store.transaction(() => nested ? store.transaction(fail) : fail()), error => {
          assert.ok(error instanceof AggregateError)
          let cause: unknown = error
          while (cause instanceof AggregateError) {
            assert.equal(cause.errors.length, 2)
            assert.equal(cause.cause, cause.errors[0])
            for (const inner of cause.errors) {
              assert.ok(inner instanceof Error)
              assert.ok(cause.message.includes(inner.message))
            }
            cause = cause.cause
          }
          assert.ok(cause instanceof Error)
          assert.match(cause.message, /UNIQUE constraint failed/i)
          return true
        })
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), false)
        store.transaction(({ outermost }) => {
          assert.equal(outermost, true)
          store.ingest('recovered IS retained', { strict: true })
        })
        assert.equal(store.claimsAbout('recovered').length, 1)
      } finally { store.close() }
    }
  })

  test(`${adapter.name}: promise-returning transaction callbacks roll back instead of committing early`, async () => {
    const store = openWith(adapter)
    try {
      store.ingest('existing IS retained')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      for (const makeResult of [() => Promise.resolve(1), () => Promise.reject(new Error('async failure')),
        () => ({ then(resolve: (value: number) => void) { resolve(1) } })]) {
        assert.throws(() => store.transaction(() => {
          store.ingest('CUSTOM IS verb\napi CUSTOM service', { strict: true })
          return makeResult()
        }), /transaction callback must be synchronous/)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), false)
      }
      let thenCalls = 0
      assert.throws(() => store.transaction(() => ({ then(resolve: (value: number) => void) {
        thenCalls += 1
        store.ingest('escaped IS unintended')
        resolve(1)
      } })), /transaction callback must be synchronous/)
      await new Promise(resolve => setTimeout(resolve, 0))
      assert.equal(thenCalls, 0, 'rejecting a thenable must not execute its asynchronous work')
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.equal(store.transaction(() => 42), 42)
      store.ingest('recovered IS retained')
      assert.equal(store.claimsAbout('recovered').length, 1)
    } finally { store.close() }
  })

  test(`${adapter.name}: native promises with shadowed then cannot commit transactions`, async () => {
    const store = openWith(adapter)
    try {
      store.ingest('existing IS retained')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      let thenReads = 0
      for (const rejected of [false, true]) for (const descriptor of [
        { value: undefined }, { value: null }, { value: 1 },
        { get() { thenReads++; throw new Error('shadowed then getter') } }
      ]) {
        assert.throws(() => store.transaction(() => {
          store.ingest('CUSTOM IS verb\napi CUSTOM service', { strict: true })
          const result = rejected ? Promise.reject(new Error('async failure')) : Promise.resolve(1)
          return Object.defineProperty(result, 'then', descriptor)
        }), /transaction callback must be synchronous/)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), false)
      }
      assert.equal(thenReads, 0)
      await new Promise(resolve => setTimeout(resolve, 0))
      assert.equal(store.transaction(() => 42), 42)
      store.ingest('recovered IS retained')
      assert.equal(store.claimsAbout('recovered').length, 1)
    } finally { store.close() }
  })

  test(`${adapter.name}: write results report affected rows and the last inserted row ID`, () => {
    const database = adapter.open(':memory:')
    try {
      database.exec('CREATE TABLE write_results (id INTEGER PRIMARY KEY, value TEXT UNIQUE)')
      const insert = database.prepare('INSERT INTO write_results(value) VALUES (?)')
      const first = insert.run('first')
      assert.equal(Number(first.changes), 1)
      assert.equal(Number(first.lastInsertRowid), 1)
      const second = insert.run('second')
      assert.equal(Number(second.changes), 1)
      assert.equal(Number(second.lastInsertRowid), 2)
      const updated = database.prepare('UPDATE write_results SET value = ? WHERE id = ?').run('updated', 1)
      assert.equal(Number(updated.changes), 1)
      assert.equal(Number(updated.lastInsertRowid), 2, 'updates retain the last insertion ID')
      const ignored = database.prepare('INSERT OR IGNORE INTO write_results(value) VALUES (?)').run('second')
      assert.equal(Number(ignored.changes), 0)
      assert.equal(Number(ignored.lastInsertRowid), 2)
      const missing = database.prepare('DELETE FROM write_results WHERE id = ?').run(100)
      assert.equal(Number(missing.changes), 0)
      assert.equal(Number(missing.lastInsertRowid), 2)
    } finally { database.close() }
  })

  test(`${adapter.name}: run completes RETURNING writes before reporting their changes`, () => {
    const db = adapter.open(':memory:')
    try {
      db.exec('CREATE TABLE returning_results (id INTEGER PRIMARY KEY, value TEXT)')
      const insert = db.prepare('INSERT INTO returning_results(value) VALUES (?), (?) RETURNING id')
      const first = insert.run('first', 'second')
      assert.equal(Number(first.changes), 2)
      assert.equal(Number(first.lastInsertRowid), 2)
      const second = insert.run('third', 'fourth')
      assert.equal(Number(second.changes), 2)
      assert.equal(Number(second.lastInsertRowid), 4)
      const update = db.prepare('UPDATE returning_results SET value = ? WHERE id <= ? RETURNING id').run('updated', 3)
      assert.equal(Number(update.changes), 3)
      const deleted = db.prepare('DELETE FROM returning_results WHERE id = ? RETURNING id').run(4)
      assert.equal(Number(deleted.changes), 1)
      const missing = db.prepare('DELETE FROM returning_results WHERE id = ? RETURNING id').run(100)
      assert.equal(Number(missing.changes), 0)
      assert.equal(Number(missing.lastInsertRowid), 4)
      assert.deepEqual(db.prepare('SELECT id, value FROM returning_results ORDER BY id').all().map(row => ({ ...row })),
        [1, 2, 3].map(id => ({ id, value: 'updated' })))
    } finally { db.close() }
  })

  test(`${adapter.name}: direct reads reject malformed Unicode without matching replacement text`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('bad�name CONTAINS child @scope:� #key:�\nbad�name ALIAS alternate', { source: 'source/�' })
      const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.equal(store.claimsAbout('bad�name').length, 2)
      assert.ok(store.search('bad�name').length > 0)
      for (const bad of ['\ud800', '\udc00']) {
        const reads = [
          () => store.search(`bad${bad}name`),
          () => store.search(`bad${bad}name`, { raw: true, limit: 0 }),
          () => store.claimsAbout(`bad${bad}name`),
          () => store.claimsAbout(`bad${bad}name`, { aliases: true }),
          () => store.aliasesOf(`bad${bad}name`),
          () => store.forward(`bad${bad}name`),
          () => store.reverse(`bad${bad}name`),
          () => store.topicMembers(`bad${bad}name`),
          () => store.topicsOf(`bad${bad}name`),
          () => store.byContext(`scope:${bad}`),
          () => store.byTag('key', bad),
          () => store.byTag(bad),
          () => store.byProvenance('actor', `source/${bad}`),
          () => store.currentBelief(bad),
          () => store.history(bad),
          () => store.provenanceOf(bad),
          () => store.edgesOf(bad),
        ]
        for (const read of reads) assert.throws(read, /unpaired UTF-16 surrogate/)
      }
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
      assert.deepEqual(store.topicMembers('bad�name'), ['child'])
      assert.equal(store.byContext('scope:�').length, 1)
      assert.equal(store.byTag('key', '�').length, 1)
    } finally { store.close() }
  })

  test(`${adapter.name}: search preserves history, phrase safety, limits and rollback`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('api HAS note: "heap dump"\nworker HAS note: "heap dump"', { strict: true })
      store.ingest('api HAS note: resolved\napi HAS note: resolved @ 0%', { strict: true })
      for (const phrase of ['heap dump', 'heap "dump"', '"heap dump"', 'heap-dump']) {
        assert.equal(store.search(phrase).length, 2, `literal phrase: ${phrase}`)
      }
      assert.equal(store.search('heap dump', { limit: 1 }).length, 1)
      assert.deepEqual(store.search('heap dump', { currentOnly: true }).map(row => row.subject), ['worker'])
      assert.deepEqual(store.search('resolved', { currentOnly: true }), [])
      for (let i = 0; i < 8; i++) store.ingest(`churn HAS note: "heap dump ${i}"`, { strict: true })
      assert.deepEqual(store.search('heap dump', { currentOnly: true, limit: 2 }).map(row => row.subject), ['churn', 'worker'])
      for (const currentOnly of [null, 'true', 1]) {
        assert.throws(() => store.search('heap dump', { currentOnly: currentOnly as unknown as boolean }), /currentOnly must be a boolean/)
      }
      store.ingest('private HAS note: visibility-marker #sensitivity:public', { strict: true })
      store.ingest('private HAS note: visibility-marker #sensitivity:restricted', { strict: true })
      assert.deepEqual(store.search('visibility-marker', { currentOnly: true, maxSensitivity: 'public' }), [])
      assert.equal(store.search('visibility-marker', { currentOnly: false, maxSensitivity: 'public' }).length, 1)
      assert.deepEqual(store.search('heap dump', { limit: 0 }), [])
      for (const empty of ['', '  ', '"', '()']) assert.deepEqual(store.search(empty), [])
      for (const raw of [false, true]) {
        for (const limit of [undefined, 0, 1]) {
          assert.throws(() => store.search('heap\u0000 AND missing', { raw, limit }), /search query.*NUL/)
        }
      }
      for (const limit of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => store.search('heap dump', { limit }), /non-negative safe integer/)
      }
      assert.throws(() => store.transaction(() => {
        store.ingest('api HAS note: transient-search-marker')
        assert.equal(store.search('transient-search-marker').length, 1)
        throw new Error('rollback search')
      }), /rollback search/)
      assert.deepEqual(store.search('transient-search-marker'), [])
      assert.equal(store.search('heap dump').length, 10, 'retracted and superseded history remains searchable')
    } finally { store.close() }
  })

  test(`${adapter.name}: current-only search agrees with current beliefs across mixed histories`, () => {
    const store = openWith(adapter)
    try {
      for (let revision = 0; revision < 5; revision++) {
        for (let key = 0; key < 20; key++) {
          const value = (key + revision) % 3 === 0 ? 'other' : `marker-${revision}`
          const confidence = (key + revision) % 7 === 0 ? 0 : 80
          store.ingest(`item-${key} HAS note: ${value} @ ${confidence}%`)
        }
      }
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const expected = store.currentBeliefs().filter(row => row.conf > 0 && row.value_text!.startsWith('marker-'))
        .sort((a, b) => a.tx < b.tx ? 1 : a.tx > b.tx ? -1 : 0)
      for (const limit of [undefined, 0, 1, 5, 100]) {
        const actual = store.search('marker', { currentOnly: true, ...limit === undefined ? {} : { limit } })
        assert.deepEqual(actual.map(row => row.id), expected.slice(0, limit).map(row => row.id))
      }
      assert.ok(store.search('marker').length > expected.length)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  })

  test(`${adapter.name}: current-only search follows pending updates and rollback`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('service HAS state: ready')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const original = store.search('ready', { currentOnly: true })
      const reason = new Error('rollback current search')
      assert.throws(() => store.transaction(() => {
        store.ingest('service HAS state: pending')
        assert.deepEqual(store.search('ready', { currentOnly: true }), [])
        assert.equal(store.search('pending', { currentOnly: true }).length, 1)
        store.ingest('service HAS state: pending @ 0%')
        assert.deepEqual(store.search('pending', { currentOnly: true }), [])
        assert.equal(store.search('pending').length, 2)
        throw reason
      }), error => error === reason)
      assert.deepEqual(store.search('ready', { currentOnly: true }), original)
      assert.deepEqual(store.search('pending'), [])
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  })

  test(`${adapter.name}: search captures limits and sensitivity before validation and execution`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('public HAS note: marker #sensitivity:public\nsecret HAS note: marker #sensitivity:restricted')
      let limitReads = 0
      assert.equal(store.search('marker', { get limit() { return ++limitReads === 1 ? 1 : 10 } }).length, 1)
      assert.equal(limitReads, 1)
      let invalidReads = 0
      assert.throws(() => store.search('marker', {
        get limit() { return ++invalidReads === 1 ? -1 : 10 },
      }), /non-negative safe integer/)
      assert.equal(invalidReads, 1)
      let sensitivityReads = 0
      assert.deepEqual(store.search('marker', {
        get maxSensitivity() { return ++sensitivityReads === 1 ? 'public' : 'restricted' },
      }).map(row => row.subject), ['public'])
      assert.equal(sensitivityReads, 1)
      store.ingest('public HAS note: updated-marker #sensitivity:public')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      for (const first of [true, false]) {
        let reads = 0
        const options = {
          maxSensitivity: 'public' as const,
          get currentOnly() { return ++reads === 1 ? first : !first }
        }
        assert.equal(store.search('marker', options).length, first ? 1 : 2)
        assert.equal(reads, 1)
        assert.equal(store.search('marker', options).length, first ? 2 : 1)
        assert.equal(reads, 2)
      }
      let invalidCurrentReads = 0
      assert.throws(() => store.search('marker', {
        get currentOnly() { return (++invalidCurrentReads === 1 ? 'true' : true) as boolean }
      }), /currentOnly must be a boolean/)
      assert.equal(invalidCurrentReads, 1)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  })

  test(`${adapter.name}: export retains captured history, sensitivity and transaction options`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('api HAS note: first #sensitivity:public')
      store.ingest('api HAS note: second #sensitivity:public')
      store.ingest('api HAS note: secret #sensitivity:restricted')
      let currentReads = 0, sensitivityReads = 0, txReads = 0
      const exported = store.exportText({
        get current() { return ++currentReads !== 1 },
        get maxSensitivity() { return ++sensitivityReads === 1 ? 'public' : 'restricted' },
        get tx() { return ++txReads === 1 },
      })
      assert.deepEqual([currentReads, sensitivityReads, txReads], [1, 1, 1])
      assert.equal(exported.match(/^\s*;@ /gm)?.length, 2)
      const expected = [
        'api HAS note: first #sensitivity:public',
        'api HAS note: second #sensitivity:public',
      ].join('\n')
      assert.deepEqual(
        canonicalizeText(exported, store.registry()).claims.map(entry => entry.claim),
        canonicalizeText(expected, store.registry()).claims.map(entry => entry.claim),
      )
      assert.equal(store.exportText({ current: true, maxSensitivity: 'public' }), '')
      assert.equal(store.currentBeliefs()[0]?.value_text, 'secret')
    } finally { store.close() }
  })

  test(`${adapter.name}: reverse snapshots retain caller rollback and release after invalid input`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('HOSTS IS verb\nHOSTS REVERSE HOSTED-BY\nfirst HOSTS api')
      const before = store.reverse('api')
      const rollback = new Error('caller rollback')
      assert.throws(() => store.transaction(() => {
        store.ingest('HOSTED-BY RENAMED-TO RESIDENT-ON\nsecond HOSTS api')
        const staged = store.reverse('api')
        assert.equal(staged.length, 2)
        assert.ok(staged.every(fact => fact.rel === 'RESIDENT-ON'))
        throw rollback
      }), error => error === rollback)
      assert.deepEqual(store.reverse('api'), before)
      assert.throws(() => store.reverse('\ud800'), /unpaired UTF-16 surrogate/)
      store.db.exec('BEGIN')
      store.db.exec('ROLLBACK')
      assert.deepEqual(store.reverse('api'), before)
    } finally { store.close() }
  })

  test(`${adapter.name}: resolution snapshots preserve caller rollback and release after read failure`, t => {
    const store = openWith(adapter)
    const failure = new Error('resolution interrupted')
    try {
      store.ingest('alice CONTAINS bob @src:cli')
      const before = store.exportText({ tx: true })
      assert.throws(() => store.transaction(() => {
        store.ingest('alice CONTAINS carol @src:cli')
        assert.equal(store.resolvedBeliefs().length, 2)
        assert.deepEqual(store.topicMembers('alice', { resolve: true }), ['bob', 'carol'])
        throw failure
      }), error => error === failure)
      assert.equal(store.exportText({ tx: true }), before)
      const prepare = store.db.prepare.bind(store.db)
      const interception = t.mock.method(store.db, 'prepare', (sql: string) => {
        if (sql.includes('ORDER BY tx') && sql.includes('res_rank')) throw failure
        return prepare(sql)
      })
      assert.throws(() => store.resolvedBeliefs(), error => error === failure)
      interception.mock.restore()
      assert.equal(store.resolvedBeliefs().length, 1)
      store.db.exec('BEGIN')
      store.db.exec('ROLLBACK')
      assert.equal(store.exportText({ tx: true }), before)
    } finally { store.close() }
  })

  test(`${adapter.name}: export snapshots preserve caller transaction rollback`, () => {
    const store = openWith(adapter)
    const rollback = new Error('caller rollback')
    try {
      store.ingest('original IS retained')
      const before = store.exportText({ tx: true })
      assert.throws(() => store.transaction(() => {
        store.ingest('staged IS visible')
        assert.match(store.exportText(), /staged IS visible/)
        throw rollback
      }), error => error === rollback)
      assert.equal(store.exportText({ tx: true }), before)
      store.ingest('later IS committed')
      assert.match(store.exportText(), /later IS committed/)
    } finally { store.close() }
  })

  test(`${adapter.name}: migration retains rollback failures and recovers after cleanup`, t => {
    for (const mode of ['before', 'after', 'automatic']) {
      const db = adapter.open(':memory:')
      const original = new Error('migration interrupted')
      const cleanup = Object.create(null)
      try {
        const exec = db.exec.bind(db)
        const failure = t.mock.method(db, 'exec', (sql: string) => {
          if (sql === 'ROLLBACK' && mode === 'before') throw cleanup
          exec(sql)
          if (sql.includes('CREATE TABLE IF NOT EXISTS cave_claim')) {
            if (mode === 'automatic') exec('ROLLBACK')
            throw original
          }
          if (sql === 'ROLLBACK' && mode === 'after') throw cleanup
        })
        try {
          assert.throws(() => Schema.init(db, adapter.capabilities), error => {
            assert.ok(error instanceof AggregateError)
            assert.equal(error.cause, original)
            assert.equal(error.errors[0], original)
            assert.equal(error.errors.length, 2)
            if (mode !== 'automatic') assert.equal(error.errors[1], cleanup)
            assert.match(error.message, /schema migration 0 -> 1 failed: migration interrupted; rollback also failed:/)
            return true
          })
        } finally { failure.mock.restore() }
        if (mode === 'before') db.exec('ROLLBACK')
        assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 0)
        assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'cave_claim'").get(), undefined)
        Schema.init(db, adapter.capabilities)
        Schema.check(db)
      } finally { db.close() }
    }
  })

  test(`${adapter.name}: migration failures retain original causes and permit retry`, t => {
    const unreadable = new Error('unreadable')
    Object.defineProperty(unreadable, 'message', { get() { throw new Error('format failed') } })
    for (const cause of [new Error('migration interrupted'), Object.create(null), unreadable]) {
      const db = adapter.open(':memory:')
      try {
        const exec = db.exec.bind(db)
        const failure = t.mock.method(db, 'exec', (sql: string) => {
          exec(sql)
          if (sql.includes('CREATE TABLE IF NOT EXISTS cave_claim')) throw cause
        })
        try {
          assert.throws(() => Schema.init(db, adapter.capabilities), error => {
            assert.ok(error instanceof Error)
            assert.equal(error.cause, cause)
            assert.match(error.message, /^CAVE: schema migration 0 -> 1 failed: /)
            assert.ok(error.message.endsWith(cause === unreadable || !(cause instanceof Error)
              ? '[unprintable thrown value]' : 'migration interrupted'))
            return true
          })
        } finally { failure.mock.restore() }
        assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 0)
        assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'cave_claim'").get(), undefined)
        Schema.init(db, adapter.capabilities)
        assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, Schema.currentVersion)
        assert.doesNotThrow(() => Schema.check(db))
      } finally { db.close() }
    }
  })

  test(`${adapter.name}: export retains claim location and unprintable read causes`, t => {
    const store = openWith(adapter)
    try {
      const id = store.ingest('original IS retained').ids[0]!
      const before = store.exportText({ tx: true, current: false })
      const unreadable = new Error('unreadable')
      Object.defineProperty(unreadable, 'message', { get() { throw new Error('format failed') } })
      const revoked = Proxy.revocable({}, {})
      revoked.revoke()
      for (const cause of [Object.create(null), unreadable, revoked.proxy]) {
        const prepare = store.db.prepare.bind(store.db)
        const failure = t.mock.method(store.db, 'prepare', (sql: string) => {
          if (sql.includes('SELECT context FROM cave_context')) throw cause
          return prepare(sql)
        })
        try {
          assert.throws(() => store.exportText({ tx: true }), error => {
            assert.ok(error instanceof Error)
            assert.equal(error.cause, cause)
            assert.equal(error.message, `CAVE export failed for claim ${id}: [unprintable thrown value]`)
            return true
          })
        } finally { failure.mock.restore() }
        store.db.exec('BEGIN')
        store.db.exec('ROLLBACK')
        assert.equal(store.exportText({ tx: true, current: false }), before)
      }
    } finally { store.close() }
  })

  test(`${adapter.name}: export retains read and snapshot-release failures and permits retry`, t => {
    const store = openWith(adapter)
    const readError = new Error('export read failed'), releaseError = new Error('export release failed')
    try {
      store.ingest('original IS retained')
      const before = store.exportText({ tx: true })
      const prepare = store.db.prepare.bind(store.db), exec = store.db.exec.bind(store.db)
      const readFailure = t.mock.method(store.db, 'prepare', (sql: string) => {
        if (sql.includes('SELECT c.* FROM cave_claim')) throw readError
        return prepare(sql)
      })
      const releaseFailure = t.mock.method(store.db, 'exec', (sql: string) => {
        exec(sql)
        if (sql === 'RELEASE cave_export_read') throw releaseError
      })
      assert.throws(() => store.exportText(), error => {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [readError, releaseError])
        assert.equal(error.cause, readError)
        assert.ok(error.message.includes(readError.message))
        assert.ok(error.message.includes(releaseError.message))
        return true
      })
      readFailure.mock.restore()
      assert.throws(() => store.exportText(), error => error === releaseError)
      releaseFailure.mock.restore()
      assert.equal(store.exportText({ tx: true }), before)
      store.ingest('later IS committed')
      assert.match(store.exportText(), /later IS committed/)
    } finally { store.close() }
  })

  test(`${adapter.name}: current beliefs capture the confidence threshold once`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('low IS observed @ 25%\nhigh IS observed @ 75%')
      let reads = 0
      const result = store.currentBeliefs({ get minConf() { return ++reads === 1 ? 0.5 : 0 } })
      assert.deepEqual(result.map(row => row.subject), ['high'])
      assert.equal(reads, 1)
      let omittedReads = 0
      assert.equal(store.currentBeliefs({ get minConf() {
        omittedReads++
        return undefined
      } }).length, 2)
      assert.equal(omittedReads, 1)
    } finally { store.close() }
  })

  test(`${adapter.name}: exact confidence survives history export and import`, () => {
    const store = openWith(adapter), restored = openWith(adapter)
    try {
      const confidences = [0, Number.MIN_VALUE, 1e-300, 0.8 * 0.9, 1 - Number.EPSILON, 1]
      store.ingest(confidences.map((conf, index) =>
        `sample-${index} IS observed @ ${Confidence.formatExact(conf)}`).join('\n'), { strict: true })
      const rows = store.currentBeliefs()
      assert.deepEqual(rows.map(row => row.conf), confidences)
      const key = rows[1]!.claim_key
      store.ingest('sample-1 IS observed @ 0%', { strict: true })
      assert.equal(store.currentBelief(key)!.conf, 0)
      store.ingest(`sample-1 IS observed @ ${Confidence.formatExact(Number.MIN_VALUE)}`, { strict: true })
      assert.equal(store.currentBelief(key)!.conf, Number.MIN_VALUE)
      assert.equal(store.currentBeliefs({ minConf: Number.MIN_VALUE }).length, confidences.length - 1)
      const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      restored.ingest(history, { strict: true })
      assert.equal(restored.exportText({ maxSensitivity: 'restricted' }),
        store.exportText({ maxSensitivity: 'restricted' }))
      const beliefValues = (source: typeof store) => source.currentBeliefs().map(row =>
        ({ key: row.claim_key, conf: row.conf }))
      assert.deepEqual(beliefValues(restored), beliefValues(store))
      for (const current of [false, true]) {
        const parsed = canonicalizeText(store.exportText({ current }))
        assert.deepEqual(parsed.problems, [])
        assert.deepEqual(parsed.claims.map(entry => entry.claim.conf),
          current ? store.currentBeliefs().map(row => row.conf) : [...confidences, 0, Number.MIN_VALUE])
      }
    } finally { restored.close(); store.close() }
  })

  test(`${adapter.name}: export captures annotation mode before database callbacks`, t => {
    const store = openWith(adapter)
    try {
      store.ingest('api IS service')
      const expected = store.exportText({ tx: true })
      const options = { tx: true }
      const prepare = store.db.prepare.bind(store.db)
      let intercepted = false
      t.mock.method(store.db, 'prepare', (sql: string) => {
        intercepted = true
        options.tx = false
        return prepare(sql)
      })
      assert.equal(store.exportText(options), expected)
      assert.equal(intercepted, true)
      assert.equal(options.tx, false)
    } finally { store.close() }
  })

  test(`${adapter.name}: sensitivity filtering preserves history without reviving hidden current beliefs`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('api HAS note: "auditmarker public" #sensitivity:public')
      store.ingest('api HAS note: "auditmarker secret" #sensitivity:confidential')
      store.ingest([
        'malformed HAS note: "auditmarker malformed" #sensitivity:unknown',
        'mixed HAS note: "auditmarker mixed" #sensitivity:public #sensitivity:restricted',
        'unlabelled HAS note: "auditmarker internal"'
      ].join('\n'), { strict: true })
      assert.equal(store.search('auditmarker', { maxSensitivity: 'public' }).length, 1)
      assert.equal(store.search('auditmarker', { maxSensitivity: 'internal' }).length, 2)
      assert.equal(store.search('auditmarker', { maxSensitivity: 'confidential' }).length, 3)
      assert.equal(store.search('auditmarker', { maxSensitivity: 'restricted' }).length, 5)
      assert.equal(store.exportText({ current: true, maxSensitivity: 'public' }), '',
        'a hidden current belief does not reveal its older public value')
      assert.match(store.exportText({ maxSensitivity: 'public' }), /auditmarker public/)
      assert.doesNotMatch(store.exportText({ maxSensitivity: 'public' }), /secret|malformed|mixed|unlabelled/)
      store.ingest('api HAS note: "auditmarker restored" #sensitivity:public')
      assert.match(store.exportText({ current: true, maxSensitivity: 'public' }), /auditmarker restored/)
      assert.doesNotMatch(store.exportText({ current: true, maxSensitivity: 'public' }), /auditmarker public/)
    } finally { store.close() }
  })

  test(`${adapter.name}: ingest preserves vocabulary through failed strict and nested writes`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('MANAGES IS verb\nMANAGES REVERSE MANAGED-BY')
      const original = store.registry()
      assert.throws(() => store.ingest('WRAPS REVERSE WRAPPED-BY\nbroken', { strict: true }))
      assert.equal(store.registry(), original)
      assert.throws(() => store.transaction(() => {
        store.ingest('WRAPS REVERSE WRAPPED-BY')
        throw new Error('discard vocabulary')
      }), /discard vocabulary/)
      assert.equal(store.registry(), original)
      store.ingest('api MANAGED-BY alice')
      const relation = store.currentBeliefs().find(row => row.subject === 'alice')
      assert.equal(relation?.verb, 'MANAGES')
      assert.equal(relation?.object, 'api')
    } finally {
      store.close()
    }
  })

  if (expectations.backup) {
    test(`${adapter.name}: snapshot capability writes a readable database`, () => {
      const directory = mkdtempSync(join(tmpdir(), "cave-adapter-contract-'-"))
      const source = join(directory, 'source.db')
      const snapshot = join(directory, 'snapshot.db')
      const capability = adapter.capabilities.backup!
      const db = adapter.open(source)
      try {
        db.exec('CREATE TABLE contract (value TEXT); INSERT INTO contract VALUES (\'ok\')')
        assert.equal(capability.inTransaction(db), false)
        assert.equal(capability.location(db), realpathSync(source))
        capability.write(db, snapshot)
      } finally {
        db.close()
      }
      try {
        const copy = adapter.open(snapshot, { readOnly: true })
        try {
          const rows = copy.prepare('SELECT value FROM contract').all()
          assert.equal(rows.length, 1)
          assert.equal(rows[0]?.['value'], 'ok')
        } finally {
          copy.close()
        }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
}
