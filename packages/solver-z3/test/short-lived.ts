import { Model, Solve } from '@cavelang/solver'
import { create } from '@cavelang/solver-z3'

const runtime = await create()
const result = await Solve.run(runtime, {
  schema: Model.schema,
  variables: [{ id: 'ok', sort: 'bool' }],
  constraints: [{ id: 'ok', expression: { kind: 'variable', id: 'ok' } }]
})
if (result.status !== 'satisfied') process.exitCode = 1
await runtime.close()
