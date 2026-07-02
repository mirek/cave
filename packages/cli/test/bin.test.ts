import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const main = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main.ts')

const run = (args: string[], input?: string) =>
  spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', main, ...args], {
    encoding: 'utf8',
    ...input === undefined ? {} : { input }
  })

test('binary: help exits 0', () => {
  const result = run(['help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage:/)
})

test('binary: parse reads stdin', () => {
  const result = run(['parse'], 'auth USES jwt\n')
  assert.equal(result.status, 0)
  assert.match(result.stdout, /1 claim/)
})

test('binary: lint failure sets exit code', () => {
  const result = run(['parse'], 'a uses b\n')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /line 1/)
})
