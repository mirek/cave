import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Adapter, Explain, Model } from '@cavelang/solver'

test('shared explanation expressions retain operand occurrences and assignment isolation', () => {
  const variable: Model.Expression = { kind: 'variable', id: 'x' }
  let shared: Model.Expression = variable
  for (let depth = 0; depth < 8; depth++) shared = { kind: 'add', operands: [shared, shared] }
  const expanded = (depth: number): Model.Expression => depth === 0 ? { ...variable } :
    { kind: 'add', operands: [expanded(depth - 1), expanded(depth - 1)] }
  for (const x of [1, -2, 0, 3]) {
    const literal = (value: number): Model.Expression => ({ kind: 'literal', sort: 'int', value: String(value) })
    const model: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'int', min: '-10', max: '10' }], constraints: [
      { id: 'shared', expression: { kind: 'eq', left: shared, right: literal(x * 256) } },
      { id: 'tree', expression: { kind: 'eq', left: expanded(8), right: literal(x * 256) } },
      { id: 'multiplicity', expression: { kind: 'neq', left: shared, right: literal(x * 256 + 1) } },
      { id: 'short-circuit', expression: { kind: 'or', operands: [
        { kind: 'literal', sort: 'bool', value: true },
        { kind: 'eq', left: { kind: 'divide', left: literal(1), right: { kind: 'subtract', left: variable, right: variable } }, right: literal(0) }
      ] } }
    ] }
    const report = Explain.report(model, { status: 'satisfied', assignment: { x: { sort: 'int', value: String(x) } },
      backend: { name: 'sharing fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
    if (report.outcome.status !== 'satisfied') assert.fail('expected feasible report')
    assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation), Array(4).fill('satisfied'))
  }
})
