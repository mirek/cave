import * as assert from 'node:assert/strict'
import { Model, Solve } from '@cavelang/solver'
import { create } from '@cavelang/solver-z3'

const model: Model.t = { schema: Model.schema, variables: [{ id: 'ok', sort: 'bool' }], constraints: [{ id: 'ok', expression: { kind: 'variable', id: 'ok' } }] }
const original = await create()
let replacement: Awaited<ReturnType<typeof create>> | undefined
try {
  const queued = Solve.run(original, model)
  const closing = original.close()
  assert.strictEqual(original.close(), closing)
  const [first, second] = await Promise.all([create(), create()])
  replacement = first
  await closing
  assert.equal((await queued).status, 'satisfied')
  assert.notStrictEqual(first, original)
  assert.strictEqual(first, second)
  assert.strictEqual(await create(), first)
  assert.equal((await Solve.run(first, model)).status, 'satisfied')
  assert.equal((await Solve.run(original, model)).status, 'unknown')
  await original.close()
  assert.strictEqual(await create(), first)
} finally {
  await original.close()
  await replacement?.close()
}
