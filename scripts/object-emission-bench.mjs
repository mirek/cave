/** Optional object-shape emission benchmark; fixtures and checks are untimed. */
import assert from 'node:assert/strict'
import { Claim, Entity, Key } from '../packages/core/src/index.ts'
import { canonicalizeText, emitClaim } from '../packages/canonical/src/index.ts'

const count = 20_000, measurements = []
const families = {
  alphabetic: i => Claim.entity('retained'),
  hyphenated: i => Claim.entity(`retained-item-${i}`),
  scoped: i => Claim.entity(`scope/item-${i}.json`),
  phrase: i => Claim.entity(`retained item ${i}`),
  unicode: i => Claim.entity(`資料/項目-${i}`),
  text: i => Claim.text(`retained item ${i}`),
  code: i => Claim.code(`item(${i})`)
}
for (const [family, objectAt] of Object.entries(families)) {
  const claims = Array.from({ length: count }, (_, i) => Claim.of({ subject: Claim.entity('subject'), verb: 'IS', payload: Claim.relation(objectAt(i)) }))
  const expected = claims.map((claim, i) => {
    const object = objectAt(i)
    return `subject IS ${Claim.formatTerm(object)}`
  })
  // Check representative semantic round trips separately from the timed emitter.
  for (const i of [0, count - 1]) {
    const parsed = canonicalizeText(expected[i])
    assert.deepEqual(parsed.problems, [])
    const object = objectAt(i)
    const normalized = object.kind === 'entity' ? Claim.entity(Entity.normalize(object.text)) : object
    assert.equal(Key.of(parsed.claims[0].claim), Key.of({ ...claims[i], payload: Claim.relation(normalized) }))
  }
  const samples = []
  for (let pass = 0; pass < 9; pass++) {
    const start = performance.now()
    const output = claims.map(emitClaim)
    const elapsed = performance.now() - start
    assert.deepEqual(output, expected)
    if (pass >= 2) samples.push(elapsed)
  }
  measurements.push({ family, count, samplesMs: samples, medianMs: [...samples].sort((a, b) => a - b)[3] })
}
console.log(JSON.stringify({ node: process.version, warmupPasses: 2, measuredPasses: 7, measurements }, null, 2))
