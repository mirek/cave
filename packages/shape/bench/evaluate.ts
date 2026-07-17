/** Deterministic large-shape benchmark with SQL statement accounting. */

import { performance } from 'node:perf_hooks'
import { open, type Store } from '@cavelang/store'
import { evaluate } from '../src/check.ts'

const expectationCount = 20
const instanceCount = 500
const store = open()
store.ingest([
  ...Array.from({ length: expectationCount }, (_, index) => `service EXPECTS field-${index}`),
  ...Array.from({ length: instanceCount }, (_, index) => `entity/${index} IS service`)
].join('\n'))

const database = store.db
let statements = 0
const counted: Store = {
  ...store,
  db: {
    exec: sql => database.exec(sql),
    prepare: sql => {
      statements += 1
      return database.prepare(sql)
    },
    close: () => database.close()
  }
}
const started = performance.now()
const result = evaluate(counted)
const ms = Number((performance.now() - started).toFixed(3))
process.stdout.write(`${JSON.stringify({
  rows: expectationCount + instanceCount,
  expectations: expectationCount,
  instances: instanceCount,
  checks: result.checks,
  violations: result.violations.length,
  sqlStatements: statements,
  ms
})}\n`)
store.close()
