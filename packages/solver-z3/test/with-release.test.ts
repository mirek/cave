import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { withRelease } from '../src/with-release.ts'

test('owned release waits for a pending operation and preserves its result', async () => {
  let settle!: (value: object) => void
  let releases = 0
  const result = {}
  const pending = withRelease(() => new Promise<object>(resolve => { settle = resolve }), () => { releases++ })
  assert.equal(releases, 0)
  settle(result)
  assert.equal(await pending, result)
  assert.equal(releases, 1)
})

for (const failure of [new Error('operation failed'), undefined, Object.create(null)]) {
  test(`operation failure survives successful release (${failure === undefined ? 'undefined' : failure instanceof Error ? 'Error' : 'unprintable'})`, async () => {
    let releases = 0
    await assert.rejects(withRelease(async () => { throw failure }, () => { releases++ }), error => error === failure)
    assert.equal(releases, 1)
  })
}

test('release failure replaces a successful operation without a second release attempt', async () => {
  const failure = new Error('release failed')
  let releases = 0
  await assert.rejects(withRelease(async () => 'sat', () => { releases++; throw failure }), error => error === failure)
  assert.equal(releases, 1)
})

for (const failure of [new Error('operation failed'), undefined]) {
  test(`operation and release failures retain their identities (${failure === undefined ? 'undefined' : 'Error'})`, async () => {
    const cleanup = Object.create(null)
    let releases = 0
    await assert.rejects(withRelease(async () => { throw failure }, () => { releases++; throw cleanup }), error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [failure, cleanup])
      assert.equal(error.cause, failure)
      assert.match(error.message, /unprintable thrown value/)
      if (failure instanceof Error) assert.match(error.message, /operation failed/)
      return true
    })
    assert.equal(releases, 1)
    assert.equal(await withRelease(async () => 'retry', () => { releases++ }), 'retry')
    assert.equal(releases, 2)
  })
}
