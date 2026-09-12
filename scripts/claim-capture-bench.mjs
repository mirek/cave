import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { canonicalizeText, standardRegistry } from '../packages/canonical/src/index.ts'
import { open, Record } from '../packages/store/src/index.ts'

// Run alone. Each sample uses a fresh store; setup and verification are untimed.
for (const claims of [100, 1_000]) for (const kind of ['relation', 'numeric-metadata']) {
  const source = Array.from({ length: claims }, (_, index) => kind === 'relation'
    ? `item/${index} IS service`
    : `item/${index} HAS latency: 42ms +/- 2ms (3σ) @ 90% @src:manual @scope:platform #reviewed ; sample`).join('\n')
  const canonical = canonicalizeText(source, standardRegistry)
  assert.equal(canonical.claims.length, claims)
  assert.deepEqual(canonical.problems, [])
  const timings = []
  for (let sample = -1; sample < 5; sample++) {
    const store = open()
    try {
      const start = performance.now()
      const result = store.insertResult(canonical)
      const elapsed = performance.now() - start
      assert.equal(result.ids.length, claims)
      assert.equal(result.skipped, 0)
      const rows = store.currentBeliefs()
      assert.equal(rows.length, claims)
      for (const row of [rows[0], rows.at(-1)]) {
        const record = store.recordOf(row)
        assert.deepEqual(Record.decode(record), record)
        if (kind === 'numeric-metadata') {
          assert.equal(row.value_num, 42)
          assert.equal(row.delta_num, 2)
          assert.equal(row.sigma_level, 3)
          assert.ok(record.provenance.sources.includes('manual'))
        }
      }
      if (sample >= 0) timings.push(elapsed)
    } finally { store.close() }
  }
  timings.sort((a, b) => a - b)
  console.log(JSON.stringify({ node: process.version, claims, kind, medianMs: timings[2] }))
}
