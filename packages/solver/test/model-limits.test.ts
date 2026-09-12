import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Adapter, Canonical, Linear, Model, Validate } from '@cavelang/solver'

const model: Model.t = {
  schema: Model.schema,
  variables: [{ id: 'enabled', sort: 'bool' }],
  constraints: [],
}

const operations = { serialize: Canonical.serialize, digest: Canonical.digest, linear: Linear.model }
for (const [name, operation] of Object.entries(operations)) {
  for (const later of [0, 1000]) {
    test(`${name} captures limits once across both model validation passes (${later})`, () => {
      let reads = 0
      const limits: Partial<Adapter.Limits> = {
        get maxVariables() { return ++reads === 1 ? 1 : later },
      }
      assert.deepEqual(operation(model, limits), operation(model, { maxVariables: 1 }))
      assert.equal(reads, 1)
    })
  }

  test(`${name} rejects an invalid initial limit even if its getter later recovers`, () => {
    let reads = 0
    assert.throws(() => operation(model, {
      get maxVariables() { return ++reads === 1 ? 0 : 1 },
    }), /maxVariables must be a positive safe integer/)
    assert.equal(reads, 1)
  })

  test(`${name} retains the numeric budget when model copying changes a bound`, () => {
    let boundReads = 0
    let limitReads = 0
    const input: Model.t = {
      schema: Model.schema,
      variables: [{ id: 'amount', sort: 'real',
        get min() { return ++boundReads === 1 ? '1' : '1e10' },
      }],
      constraints: [],
    }
    assert.throws(() => operation(input, {
      get maxNumericDigits() { return ++limitReads === 1 ? 2 : 100 },
    }), (error: unknown) => {
      assert.ok(error instanceof Validate.ModelLimitError)
      assert.equal(error.limit, 'maxNumericDigits')
      assert.equal(error.maximum, 2)
      assert.ok(error.actual > error.maximum)
      return true
    })
    assert.equal(boundReads, 2)
    assert.equal(limitReads, 1)
  })
}

test('shared repeated squaring cannot bypass the numeric budget before linear arithmetic', () => {
  const input = (depth: number): Model.t => {
    let divisor: Model.Expression = { kind: 'literal', sort: 'real', value: '9'.repeat(300) }
    for (let level = 0; level < depth; level++) divisor = { kind: 'multiply', operands: [divisor, divisor] }
    return {
      schema: Model.schema,
      variables: [{ id: 'x', sort: 'real' }], constraints: [],
      objectives: [{ id: 'scaled', direction: 'minimize', expression: {
        kind: 'divide', left: { kind: 'variable', id: 'x' }, right: divisor
      } }]
    }
  }
  const allowed = input(8), rejected = input(9)
  for (const operation of Object.values(operations)) {
    assert.doesNotThrow(() => operation(allowed))
    assert.throws(() => operation(rejected), (error: unknown) => {
      assert.ok(error instanceof Validate.ModelLimitError)
      assert.equal(error.limit, 'maxNumericDigits')
      assert.equal(error.maximum, 100_000)
      assert.ok(error.actual > error.maximum)
      return true
    })
  }
  assert.deepEqual(Linear.model(allowed), { linear: true, problems: [] })
})
