/** Optional bulk-emission measurement; fixture generation and checks are untimed. */
import assert from 'node:assert/strict'
import { Claim } from '../packages/core/src/index.ts'
import { emitClaim } from '../packages/canonical/src/index.ts'

const count = 20_000, measurements = []
for (const family of ['ascii', 'unicode', 'literal']) {
  const claims = Array.from({ length: count }, (_, index) => Claim.of({
    subject: family === 'literal' ? Claim.text(`source item ${index}`) : Claim.entity(`${family === 'ascii' ? 'scope/item' : '資料/項目'}-${index}`),
    verb: 'IS', payload: Claim.relation(Claim.entity('retained'))
  }))
  const expected = claims.map(claim => `${Claim.formatTerm(claim.subject)} IS retained`)
  const samples = []
  for (let pass = 0; pass < 9; pass++) {
    const start = performance.now()
    const output = claims.map(claim => emitClaim(claim))
    const elapsed = performance.now() - start
    assert.deepEqual(output, expected)
    if (pass >= 2) samples.push(elapsed)
  }
  measurements.push({ family, count, samplesMs: samples, medianMs: [...samples].sort((a, b) => a - b)[3] })
}
console.log(JSON.stringify({ node: process.version, warmupPasses: 2, measuredPasses: 7, measurements }, null, 2))
