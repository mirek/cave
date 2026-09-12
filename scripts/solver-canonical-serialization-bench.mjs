import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Canonical, Model } from '../packages/solver/src/index.ts'

const count = Number(process.argv[2] ?? 5000)
const mode = process.argv[3] ?? 'shared'
assert.ok(mode === 'shared' || mode === 'unshared', 'mode must be shared or unshared')
assert.ok(Number.isSafeInteger(count) && count > 0 && count <= 5000, 'constraint count must be 1..5000')
const expression = {
  kind: 'and',
  operands: Array.from({ length: 10 }, (_, index) => ({ kind: 'literal', sort: 'bool', value: index % 2 === 0 }))
}
const sharedModel = {
  schema: Model.schema,
  variables: [],
  constraints: Array.from({ length: count }, (_, index) => ({ id: `c${index}`, expression }))
}
const model = mode === 'shared' ? sharedModel : JSON.parse(JSON.stringify(sharedModel))
const samplesMs = []
let digest, bytes
for (let sample = 0; sample < 4; sample++) {
  const start = performance.now()
  const result = Canonical.serialize(model)
  samplesMs.push(performance.now() - start)
  const next = createHash('sha256').update(result).digest('hex')
  if (digest !== undefined) assert.equal(next, digest)
  digest = next
  bytes = Buffer.byteLength(result)
  assert.equal(JSON.parse(result).constraints.length, count)
}
console.log(JSON.stringify({ node: process.version, count, mode, samplesMs,
  medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1],
  maxRssKiB: process.resourceUsage().maxRSS, bytes, digest }))
