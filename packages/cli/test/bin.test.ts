import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

test('binary: per-command help is discoverable', () => {
  const result = run(['query', '--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage:/)
  assert.match(result.stdout, /Examples:/)
  assert.equal(run(['help', 'export']).status, 0)
  assert.match(run(['help', 'ingest']).stdout, /LLM-driven ingestion/)
  assert.match(run(['help', 'eval']).stdout, /golden-fixture extraction, query and reconstruction evals/)
  assert.match(run(['reconstruct', '--help']).stdout, /active memory reconstruction/)
  assert.match(run(['mcp', '--help']).stdout, /MCP server on stdio/)
})

test('binary: automate routes through main and settles once (spec §29.5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-'))
  const db = join(dir, 'k.db')
  assert.match(run(['automate', '--help']).stdout, /event-driven loop/)
  assert.match(run(['help', 'automate']).stdout, /event-driven loop/)

  const declared = run(['automate', '--db', db, '--declare'],
    'automation/watch HAS automation: `?x IS hot => hook/log`\n')
  assert.equal(declared.status, 0)
  assert.match(declared.stdout, /declared 1 automation\(s\)/)

  assert.equal(run(['add', '--db', db], 'api IS hot\n').status, 0)
  const once = run(['automate', '--db', db, '--once'])
  assert.equal(once.status, 0)
  assert.match(once.stdout, /automation\/watch: fired 1 solution\(s\)/)
  assert.match(once.stdout, /hook\/log: not-configured/)

  const again = run(['automate', '--db', db, '--once'])
  assert.equal(again.status, 0)
  assert.match(again.stdout, /settled: 0 firing\(s\)/)
  rmSync(dir, { recursive: true, force: true })
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
