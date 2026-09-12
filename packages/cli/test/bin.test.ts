import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import type { Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PassThrough, Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { dispatch } from '@cavelang/cli'
import { open } from '@cavelang/store'

const main = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main.ts')

const run = (args: string[], input?: string | Uint8Array) =>
  spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', main, ...args], {
    encoding: 'utf8',
    ...input === undefined ? {} : { input }
  })

const exitOf = (child: ReturnType<typeof spawn>): Promise<{ code: null | number, signal: null | NodeJS.Signals }> =>
  new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })

test('binary: partial action declarations exit 1 and corrected retries preserve accepted work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-act-partial-cli-'))
  const db = join(dir, 'knowledge.db')
  const file = join(dir, 'actions.cave')
  const history = () => {
    const store = open(db, { access: 'read-only' })
    try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) }
    finally { store.close() }
  }
  try {
    writeFileSync(file, 'action/mark HAS action: `=> api IS old`')
    assert.equal(run(['act', '--db', db, '--declare', file]).status, 0)
    const lines = [
      'action/mark HAS action: `missing arrow`',
      'action/mark HAS hook: notify',
      'action/other HAS action: `=> other IS ready`'
    ]
    writeFileSync(file, lines.join('\r\n'))
    const partial = run(['act', '--db', db, '--declare', file])
    assert.equal(partial.error, undefined)
    assert.equal(partial.status, 1)
    assert.equal(partial.stdout, 'declared 1 action(s), +1 prelude claim(s)\n')
    assert.match(partial.stderr, /line 1:.*no top-level "=>"/)
    const listing = run(['act', '--db', db, '--list', '--json'])
    assert.equal(listing.status, 0)
    const actions = JSON.parse(listing.stdout) as { name: string, text: string, hook?: string }[]
    assert.equal(actions.find(action => action.name === 'mark')?.text, '=> api IS old')
    assert.equal(actions.find(action => action.name === 'mark')?.hook, 'notify')
    assert.ok(actions.some(action => action.name === 'other'))
    const accepted = history()
    const repeated = run(['act', '--db', db, '--declare', file])
    assert.equal(repeated.status, 1)
    assert.equal(repeated.stdout, 'declared 0 action(s), 1 unchanged\n')
    assert.equal(repeated.stderr, partial.stderr)
    assert.equal(history(), accepted)
    lines[0] = 'action/mark HAS action: `=> api IS new`'
    writeFileSync(file, lines.join('\r\n'))
    const corrected = run(['act', '--db', db, '--declare', file])
    assert.equal(corrected.status, 0)
    assert.equal(corrected.stdout, 'declared 1 action(s), 1 unchanged\n')
    assert.equal(corrected.stderr, '')
    const correctedHistory = history()
    const unchanged = run(['act', '--db', db, '--declare', file])
    assert.equal(unchanged.status, 0)
    assert.equal(unchanged.stdout, 'declared 0 action(s), 2 unchanged\n')
    assert.equal(history(), correctedHistory)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('binary: help exits 0', () => {
  const result = run(['help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage:/)
})

test('dispatcher stops pre-cancelled commands before producing help or reading input', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancel before dispatch'))
  let reads = 0
  const stdin = new Readable({ read() { reads++; this.push(null) } })
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let out = ''
  let err = ''
  stdout.on('data', chunk => { out += String(chunk) })
  stderr.on('data', chunk => { err += String(chunk) })
  try {
    for (const command of ['ingest', 'eval', 'connect', 'automate', 'serve', 'mcp', 'parse', 'reconstruct', 'suggest-alias', 'highlight']) {
      assert.equal(await dispatch([command, '--help'], { stdin, stdout, stderr, signal: controller.signal }), 0, command)
      assert.equal(out, '', command)
      assert.equal(err, '', command)
      assert.equal(reads, 0, command)
    }
    assert.equal(await dispatch(['ingest', '--help'], { stdin, stdout, stderr }), 0)
    assert.match(out, /LLM-driven ingestion/)
  } finally {
    stdin.destroy()
    stdout.destroy()
    stderr.destroy()
  }
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

test('binary: serve answers HTTP and shuts down with an unfinished request (spec §30.3)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-'))
  const db = join(dir, 'k.db')
  assert.match(run(['serve', '--help']).stdout, /browse a CAVE store/)
  assert.match(run(['help', 'serve']).stdout, /browse a CAVE store/)
  const surplus = run(['help', 'serve', 'extra'])
  assert.equal(surplus.status, 2)
  assert.match(surplus.stderr, /unexpected positional arguments/)
  assert.equal(run(['serve', '--db', db, '--port', 'nope']).status, 1)
  assert.equal(run(['add', '--db', db], 'api IS hot\n').status, 0)

  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main, 'serve', '--db', db, '--port', '0'])
  const exited = exitOf(child)
  let unfinished: Socket | undefined
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined
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
    const address = new URL(url)
    unfinished = createConnection({ host: address.hostname, port: Number(address.port) })
    unfinished.on('error', () => {}) // Shutdown may reset the unfinished request.
    await once(unfinished, 'connect')
    const disconnected = new Promise<void>(resolve => unfinished!.once('close', () => resolve()))
    unfinished.write('GET /api/overview HTTP/1.1\r\nHost: localhost\r\nX-Unfinished: ')
    // A separate completed request verifies the server remains responsive while
    // the first client holds its headers open.
    const page = await fetch(url)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /<!doctype html>/)
    const matches = await (await fetch(`${url}api/search?q=hot`)).json() as { subject: string }[]
    assert.equal(matches.length, 1)
    assert.equal(matches[0]!.subject, 'api')
    child.kill('SIGTERM')
    const stopped = await Promise.race([
      Promise.all([exited, disconnected]).then(([exit]) => exit),
      new Promise<never>((_resolve, reject) => {
        shutdownTimer = setTimeout(() => reject(new Error('unfinished request blocked shutdown')), 5_000)
      })
    ])
    assert.deepEqual(stopped, { code: 143, signal: null }, 'SIGTERM is handled after awaited server/store cleanup')
  } finally {
    clearTimeout(shutdownTimer)
    unfinished?.destroy()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
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

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
  test(`binary: ${signal} cancels pending automation declaration stdin quietly`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-cli-declare-cancel-'))
    const db = join(dir, 'k.db')
    const preload = join(dir, 'ready.mjs')
    // Observe the real stdin starting, without substituting its implementation.
    writeFileSync(preload, "process.stdin.once('resume', () => process.stderr.write('READY\\n'))")
    assert.equal(run(['add', '--db', db], 'seed IS known\n').status, 0)
    const before = run(['export', '--db', db, '--tx', '--max-sensitivity', 'restricted'])
    assert.equal(before.status, 0, before.stderr)
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', preload, main, 'automate', '--db', db, '--declare'])
    const exited = exitOf(child)
    let output = ''
    let errors = ''
    child.stdout.on('data', chunk => { output += String(chunk) })
    child.stderr.on('data', chunk => { errors += String(chunk) })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const ready = once(child.stderr, 'data', { signal: AbortSignal.timeout(15_000) })
      child.stdin.write('partial IS forbidden\n')
      await ready
      assert.equal(errors, 'READY\n')
      child.kill(signal)
      assert.deepEqual(await Promise.race([exited, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('declaration did not stop after signal')), 10_000)
      })]), { code, signal: null })
      assert.equal(output, '')
      assert.equal(errors, 'READY\n')
      const after = run(['export', '--db', db, '--tx', '--max-sensitivity', 'restricted'])
      assert.equal(after.status, 0, after.stderr)
      assert.equal(after.stdout, before.stdout)
    } finally {
      clearTimeout(timer)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exited
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('binary: SIGINT cancels ingestion while a URL body is pending', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-ingest-cancel-'))
  const db = join(dir, 'k.db')
  const marker = join(dir, 'agent-started')
  const agent = join(dir, 'agent.mjs')
  writeFileSync(agent, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started')`)
  assert.equal(run(['add', '--db', db], 'seed IS known\n').status, 0)
  const before = run(['export', '--db', db]).stdout
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.write('unfinished source')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const requested = once(server, 'request', { signal: AbortSignal.timeout(15_000) })
  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', main, 'ingest',
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/source`,
    '--db', db, '--stdout', '--agent', `node '${agent}'`
  ])
  const exited = exitOf(child)
  let errors = ''
  child.stderr.on('data', chunk => { errors += String(chunk) })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await requested
    child.kill('SIGINT')
    const result = await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('ingestion did not exit after SIGINT')), 10_000)
      })
    ])
    assert.deepEqual(result, { code: 130, signal: null })
    assert.equal(errors, '')
    assert.equal(existsSync(marker), false)
    const after = run(['export', '--db', db])
    assert.equal(after.status, 0, after.stderr)
    assert.equal(after.stdout, before)
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('binary: cancellation kills an agent and its descendants before exiting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-process-'))
  const db = join(dir, 'k.db')
  const marker = join(dir, 'descendant-survived')
  const started = join(dir, 'descendant-started')
  const probe = join(dir, 'probe-after-exit')
  const agent = join(dir, 'agent.mjs')
  // Only a descendant surviving CLI exit can answer this probe. A startup
  // timer could fire before cancellation when the test runner is under load.
  const grandchild = [
    `const { existsSync, writeFileSync } = require('node:fs')`,
    `writeFileSync(${JSON.stringify(started)}, 'started')`,
    `const poll = setInterval(() => {`,
    `  if (!existsSync(${JSON.stringify(probe)})) return`,
    `  writeFileSync(${JSON.stringify(marker)}, 'leak')`,
    `  clearInterval(poll)`,
    `}, 20)`,
    `setTimeout(() => clearInterval(poll), 10000).unref()`
  ].join('\n')
  writeFileSync(agent, [
    `import { spawn } from 'node:child_process'`,
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
    assert.equal(existsSync(started), true, 'the descendant entered the agent process boundary')
    child.kill('SIGTERM')
    assert.deepEqual(await exited, { code: 143, signal: null })
    writeFileSync(probe, 'probe')
    await delay(900)
    assert.equal(existsSync(marker), false)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exited
    rmSync(dir, { recursive: true, force: true })
  }
})

test('binary: multiline query errors preserve source locations and leave the store usable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-query-errors-'))
  const db = join(dir, 'query.db')
  try {
    const added = run(['add', '--db', db], 'api IS service @ 85%\n')
    assert.equal(added.status, 0, added.stderr)
    const before = run(['export', '--db', db, '--tx'])
    assert.equal(before.status, 0, before.stderr)
    for (const newline of ['\n', '\r\n']) {
      const lines = ['', '; query header', '?entity IS service', '', '; threshold', 'WHERE conf >= Infinity']
      for (const positional of [[lines.join(newline)], [lines.slice(0, 5).join(newline), lines[5]!]]) {
        for (const format of [[], ['--json']]) {
          const result = run(['query', '--db', db, ...positional, ...format])
          assert.equal(result.status, 1)
          assert.equal(result.stdout, '')
          assert.match(result.stderr, /CAVE-Q line 6: cannot parse confidence "Infinity"/)
          assert.doesNotMatch(result.stderr, /\n\s+at /)
        }
      }
    }
    const corrected = run(['query', '--db', db, '?entity IS service', 'WHERE conf >= 0.7', '--json'])
    assert.equal(corrected.status, 0, corrected.stderr)
    assert.equal(JSON.parse(corrected.stdout).matches[0].bindings.entity, 'api')
    const after = run(['export', '--db', db, '--tx'])
    assert.equal(after.status, 0, after.stderr)
    assert.equal(after.stdout, before.stdout)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('binary: invalid UTF-8 files and stdin fail before claims are appended', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-utf8-'))
  const db = join(dir, 'k.db')
  const file = join(dir, 'bad.cave')
  const bad = Buffer.concat([Buffer.from('partial IS forbidden\napi HAS label: "bad'), Buffer.from([0xff]), Buffer.from('text"')])
  try {
    assert.equal(run(['add', '--db', db], 'seed IS retained').status, 0)
    const before = run(['export', '--db', db, '--tx']).stdout
    writeFileSync(file, bad)
    for (const command of ['parse', 'add', 'import']) {
      for (const stdin of [false, true]) {
        const args = command === 'parse' ? [command, '--json'] : [command, '--db', db]
        const result = run([...args, stdin ? '-' : file], stdin ? bad : undefined)
        assert.equal(result.status, 1, `${command}: ${result.stderr}`)
        assert.equal(result.stdout, '')
        assert.match(result.stderr, /invalid UTF-8 input/)
        assert.ok(result.stderr.includes(stdin ? 'stdin' : file))
      }
    }
    assert.equal(run(['export', '--db', db, '--tx']).stdout, before)
    const fresh = join(dir, 'not-created.db')
    assert.equal(run(['add', '--db', fresh, file]).status, 1)
    assert.equal(existsSync(fresh), false)
    assert.equal(run(['add', '--db', db], 'api HAS label: "�café 😀"').status, 0)
    const recovered = run(['query', '--db', db, '?x HAS label: "�café 😀"'])
    assert.equal(recovered.status, 0, recovered.stderr)
    assert.match(recovered.stdout, /\?x = api/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
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
