import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PassThrough, Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { dispatch } from '@cavelang/cli'

const main = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main.ts')

const run = (args: string[], input?: string) =>
  spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', main, ...args], {
    encoding: 'utf8',
    ...input === undefined ? {} : { input }
  })

const exitOf = (child: ReturnType<typeof spawn>): Promise<{ code: null | number, signal: null | NodeJS.Signals }> =>
  new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })

test('binary: help exits 0', () => {
  const result = run(['help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage:/)
})

test('dispatcher gives synchronous and asynchronous commands one I/O and exit contract', async () => {
  const captured = async (argv: string[], input = ''): Promise<{ code: number, out: string, err: string }> => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let out = ''
    let err = ''
    stdout.on('data', chunk => { out += String(chunk) })
    stderr.on('data', chunk => { err += String(chunk) })
    const code = await dispatch(argv, { stdin: Readable.from([input]), stdout, stderr })
    return { code, out, err }
  }
  const sync = await captured(['query', '--help'])
  assert.equal(sync.code, 0)
  assert.match(sync.out, /cave query/)
  const async = await captured(['ingest', '--help'])
  assert.equal(async.code, 0)
  assert.match(async.out, /LLM-driven ingestion/)
})

test('binary: synchronous and asynchronous argument failures share formatting and exit behavior', () => {
  for (const command of ['parse', 'ingest']) {
    const result = run([command, '--definitely-invalid'])
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, new RegExp(`^cave ${command}: Unknown option`))
    assert.doesNotMatch(result.stderr, /\n\s+at /, 'default diagnostics are stack-free')
  }
  const debug = spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning', main, 'ingest', '--definitely-invalid'
  ], { encoding: 'utf8', env: { ...process.env, CAVE_DEBUG: '1' } })
  assert.equal(debug.status, 1)
  assert.match(debug.stderr, /\n\s+at /, 'CAVE_DEBUG=1 retains the diagnostic stack')
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

test('binary: serve routes through main and answers over HTTP (spec §30.3)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-'))
  const db = join(dir, 'k.db')
  assert.match(run(['serve', '--help']).stdout, /browse a CAVE store/)
  assert.match(run(['help', 'serve']).stdout, /browse a CAVE store/)
  assert.equal(run(['serve', '--db', db, '--port', 'nope']).status, 1)
  assert.equal(run(['add', '--db', db], 'api IS hot\n').status, 0)

  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main, 'serve', '--db', db, '--port', '0'])
  const exited = exitOf(child)
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('serve did not print its URL')), 15_000)
      let seen = ''
      child.stdout.on('data', chunk => {
        seen += String(chunk)
        const match = seen.match(/at (http:\/\/\S+\/)/)
        if (match !== null) {
          clearTimeout(timer)
          resolve(match[1]!)
        }
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('serve exited before printing its URL'))
      })
    })
    const page = await fetch(url)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /<!doctype html>/)
    const matches = await (await fetch(`${url}api/search?q=hot`)).json() as { subject: string }[]
    assert.equal(matches.length, 1)
    assert.equal(matches[0]!.subject, 'api')
    child.kill('SIGTERM')
    assert.deepEqual(await exited, { code: 143, signal: null }, 'SIGTERM is handled after awaited server/store cleanup')
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exited
    rmSync(dir, { recursive: true, force: true })
  }
})

test('binary: automate polls live writes once, then awaits timer and store cleanup on signal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-'))
  const db = join(dir, 'k.db')
  const declared = run(['automate', '--db', db, '--declare'],
    'automation/watch HAS automation: `?x IS hot => hook/log`\n')
  assert.equal(declared.status, 0, declared.stderr)
  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', main, 'automate', '--db', db, '--interval', '0.05'
  ])
  const exited = exitOf(child)
  let output = ''
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('automate did not enter watch mode')), 15_000)
      child.stdout.on('data', chunk => {
        output += String(chunk)
        if (output.includes('watching')) {
          clearTimeout(timer)
          resolve()
        }
      })
    })

    const added = run(['add', '--db', db], 'api IS hot\n')
    assert.equal(added.status, 0, added.stderr)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('automate polling did not report the live write')), 15_000)
      const inspect = (): void => {
        if (output.includes('automation/watch: fired 1 solution(s)')) {
          clearTimeout(timer)
          resolve()
        }
      }
      child.stdout.on('data', inspect)
      inspect()
    })

    child.kill('SIGINT')
    assert.deepEqual(await exited, { code: 130, signal: null })
    const quiet = run(['automate', '--db', db, '--once'])
    assert.equal(quiet.status, 0, 'the cleaned store reopens immediately')
    assert.match(quiet.stdout, /settled: 0 firing\(s\)/, 'the processed event is neither retried nor echoed')
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exited
    rmSync(dir, { recursive: true, force: true })
  }
})

test('binary: cancellation kills an agent and its descendants before exiting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-process-'))
  const db = join(dir, 'k.db')
  const marker = join(dir, 'descendant-survived')
  const started = join(dir, 'agent-started')
  const agent = join(dir, 'agent.mjs')
  const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'leak'), 700)`
  writeFileSync(agent, [
    `import { spawn } from 'node:child_process'`,
    `import { writeFileSync } from 'node:fs'`,
    `writeFileSync(${JSON.stringify(started)}, 'started')`,
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' })`,
    `setInterval(() => {}, 1000)`
  ].join('\n'))
  assert.equal(run(['add', '--db', db], 'seed IS known\n').status, 0)
  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', main,
    'reconstruct', '--db', db, 'seed', '--agent', `node '${agent}'`
  ])
  const exited = exitOf(child)
  try {
    for (let attempt = 0; attempt < 250 && !existsSync(started); attempt += 1) await delay(20)
    assert.equal(existsSync(started), true, 'the agent entered its process boundary')
    child.kill('SIGTERM')
    assert.deepEqual(await exited, { code: 143, signal: null })
    await delay(900)
    assert.equal(existsSync(marker), false)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exited
    rmSync(dir, { recursive: true, force: true })
  }
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
