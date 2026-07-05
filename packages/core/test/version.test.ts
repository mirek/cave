import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Version } from '@cavelang/core'

test('Version.current() reads the lockstep package version', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { version: string }
  assert.equal(Version.current(), manifest.version)
})
