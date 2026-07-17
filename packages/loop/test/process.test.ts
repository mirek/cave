import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import {
  ProcessFailure,
  directCommand,
  quoteShellArgument,
  runProcess,
  runProcessSync,
  shellCommand
} from '@cavelang/loop'

test('direct commands preserve argument boundaries without shell interpolation', async () => {
  const values = ['space value', `quote'\"value`, '$() & | ; < > % !', 'żółw 🐢']
  const result = await runProcess(directCommand(process.execPath, [
    '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...values
  ]))
  assert.equal(result.code, 0)
  assert.deepEqual(JSON.parse(result.stdout), values)
})

test('intentional shell commands use platform quoting for substituted values', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cave-process shell-'))
  const script = join(directory, 'print args.mjs')
  const value = `space ' \" $() & | ; < > % ! żółw 🐢`
  try {
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n')
    const result = await runProcess(shellCommand('node {script} {value}', { script, value }), { cwd: directory })
    assert.equal(result.code, 0)
    assert.deepEqual(JSON.parse(result.stdout), [value])
    assert.equal(quoteShellArgument("it's", 'posix'), `'it'\\''s'`)
    assert.equal(quoteShellArgument("it's", 'powershell'), `'it''s'`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('non-zero exits return normalized stdout, stderr, code, and signal', async () => {
  const result = await runProcess(directCommand(process.execPath, [
    '-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(7)'
  ]))
  assert.deepEqual(result, { code: 7, signal: null, stdout: 'out', stderr: 'err' })
})

test('spawn failures are typed without exposing command, input, or environment data', async () => {
  const secret = `secret-${Date.now()}`
  await assert.rejects(
    runProcess(directCommand(`missing-${secret}`, [secret]), {
      input: secret,
      env: { CAVE_PROCESS_SECRET: secret }
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProcessFailure)
      assert.equal(error.kind, 'spawn')
      assert.doesNotMatch(JSON.stringify(error.toJSON()), new RegExp(secret))
      return true
    }
  )
})

test('stdout and stderr limits fail with typed, bounded diagnostics', async () => {
  for (const stream of ['stdout', 'stderr'] as const) {
    await assert.rejects(
      runProcess(directCommand(process.execPath, [
        '-e', `process.${stream}.write("x".repeat(4096)); setInterval(()=>{}, 1000)`
      ]), {
        maxStdoutBytes: stream === 'stdout' ? 128 : 1024,
        maxStderrBytes: stream === 'stderr' ? 128 : 1024
      }),
      (error: unknown) => {
        assert.ok(error instanceof ProcessFailure)
        assert.equal(error.kind, `${stream}-limit`)
        assert.equal(Buffer.byteLength(error.result[stream]), 128)
        assert.doesNotMatch(error.message, /process\.stdout|process\.stderr/)
        return true
      }
    )
  }
})

test('timeouts and cancellation have distinct typed outcomes', async () => {
  await assert.rejects(
    runProcess(directCommand(process.execPath, ['-e', 'setInterval(()=>{}, 1000)']), { timeoutMs: 50 }),
    (error: unknown) => error instanceof ProcessFailure && error.kind === 'timeout'
  )

  const controller = new AbortController()
  const running = runProcess(
    directCommand(process.execPath, ['-e', 'setInterval(()=>{}, 1000)']),
    { signal: controller.signal }
  )
  setTimeout(() => controller.abort(), 50)
  await assert.rejects(running,
    (error: unknown) => error instanceof ProcessFailure && error.kind === 'aborted')
})

test('cancellation kills descendant processes before they can outlive the command', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cave-process-tree-'))
  const marker = join(directory, 'descendant-survived')
  const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'leak'), 700)`
  const parent = [
    `const { spawn } = require('node:child_process')`,
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' })`,
    `setInterval(() => {}, 1000)`
  ].join(';')
  const controller = new AbortController()
  try {
    const running = runProcess(directCommand(process.execPath, ['-e', parent]), { signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    await assert.rejects(running,
      (error: unknown) => error instanceof ProcessFailure && error.kind === 'aborted')
    await delay(900)
    assert.equal(existsSync(marker), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the synchronous bridge preserves direct execution and typed limits', () => {
  const result = runProcessSync(directCommand(process.execPath, ['-e', 'process.stdout.write("sync ✓")']))
  assert.deepEqual(result, { code: 0, signal: null, stdout: 'sync ✓', stderr: '' })
  assert.throws(
    () => runProcessSync(
      directCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(1024))']),
      { maxStdoutBytes: 64 }
    ),
    (error: unknown) => error instanceof ProcessFailure && error.kind === 'stdout-limit'
  )
})

test('the synchronous bridge kills a timed-out descendant tree', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cave-process-sync-tree-'))
  const marker = join(directory, 'descendant-survived')
  const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'leak'), 700)`
  const parent = [
    `const { spawn } = require('node:child_process')`,
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' })`,
    `setInterval(() => {}, 1000)`
  ].join(';')
  try {
    assert.throws(
      () => runProcessSync(directCommand(process.execPath, ['-e', parent]), { timeoutMs: 100 }),
      (error: unknown) => error instanceof ProcessFailure && error.kind === 'timeout'
    )
    await delay(900)
    assert.equal(existsSync(marker), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
