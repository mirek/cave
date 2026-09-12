import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { run } from '../src/run.ts'
import * as Score from '../src/score.ts'

const invalidValues = () => [
  Symbol('option'), Object.create(null),
  { [Symbol.toPrimitive]() { throw new Error('unexpected option coercion') } },
]

for (const field of ['tolerance', 'runs'] as const) {
  test(`evaluation retains ${field} diagnostics for unprintable settings`, async () => {
    for (const value of invalidValues()) {
      await assert.rejects(run({ suites: ['missing-suite'], [field]: value as number }),
        field === 'tolerance' ? /tolerance must be a finite number in \[0, 1\], got / : /runs must be a positive safe integer, got /)
    }
    const result = await run({ suites: [], [field]: field === 'tolerance' ? 0 : 1 })
    assert.deepEqual(result.cases, [])
  })
}

test('direct scoring retains tolerance diagnostics for unprintable settings', () => {
  for (const value of invalidValues()) {
    assert.throws(() => Score.compare([], [], { tolerance: value as number }),
      /tolerance must be a finite number in \[0, 1\], got /)
  }
  assert.equal(Score.compare([], [], { tolerance: 0 }).f1, 0)
})
