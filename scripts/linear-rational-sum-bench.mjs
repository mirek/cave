/** Local observations of rational sums in classification and explanation, not CI timing gates. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Adapter, Explain, Linear, Model } from '../packages/solver/src/index.ts'

const operation = process.argv[2] ?? 'linear'
assert.ok(operation === 'linear' || operation === 'explain', 'expected linear or explain')
const shape = process.argv[3] ?? 'distinct'
assert.ok(['distinct', 'equal', 'cancelling', 'integers'].includes(shape), 'expected distinct, equal, cancelling or integers')

for (const count of [32, 128, 512]) {
  const operands = Array.from({ length: count }, (_, index) => ({
    kind: 'literal', sort: 'real', value: shape === 'integers' ? '1' : {
      numerator: shape === 'cancelling' && index % 2 === 1 ? '-1' : '1',
      denominator: String(10n ** 30n + 3n + 2n * BigInt(shape === 'equal' ? 0 : shape === 'cancelling' ? Math.floor(index / 2) : index))
    }
  }))
  const model = {
    schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [],
    objectives: [{ id: 'scaled', direction: 'minimize', expression: {
      kind: 'divide', left: { kind: 'variable', id: 'x' }, right: { kind: 'add', operands }
    } }]
  }
  const explanationModel = {
    schema: Model.schema, variables: [], constraints: [{ id: 'positive', expression: {
      kind: 'gt', left: { kind: 'add', operands }, right: { kind: 'literal', sort: 'real', value: '0' }
    } }]
  }
  const outcome = { status: 'satisfied', assignment: {}, backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
  const samples = []
  for (let trial = 0; trial < 4; trial++) {
    const start = performance.now()
    const result = operation === 'linear' ? Linear.model(model) : Explain.report(explanationModel, outcome, Adapter.defaultLimits)
    samples.push(performance.now() - start)
    if (operation === 'linear') assert.equal(result.linear, shape !== 'cancelling')
    else assert.equal(result.outcome.hardConstraints[0].evaluation, shape === 'cancelling' ? 'violated' : 'satisfied')
  }
  const measured = samples.slice(1).sort((a, b) => a - b)
  console.log(JSON.stringify({ node: process.version, operation, shape, count, samplesMs: samples, medianMs: measured[1] }))
}
