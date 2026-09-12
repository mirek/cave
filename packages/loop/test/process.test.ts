import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { getEventListeners } from 'node:events'
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

test('process runners preserve captured deadlines across option serialization', async () => {
  const command = directCommand(process.execPath, ['-e', 'setTimeout(() => {}, 500)'])
  for (const run of [runProcess, runProcessSync]) {
    let reads = 0
    const cases = [
      Object.create({ timeoutMs: 100 }),
      Object.defineProperty({}, 'timeoutMs', { value: 100 }),
      { get timeoutMs() { return ++reads === 1 ? 100 : 0 } },
      { timeoutMs: 100, toJSON: () => ({ timeoutMs: 0 }) }
    ]
    for (const options of cases) {
      await assert.rejects(Promise.resolve().then(() => run(command, options)),
        error => error instanceof ProcessFailure && error.kind === 'timeout')
    }
    assert.equal(reads, 1)
  }
})

test('both runners execute command fields independently of property enumeration and toJSON', async () => {
  const command = directCommand(process.execPath, ['-e', 'process.stdout.write("intended")'])
  const hidden = Object.defineProperties({}, {
    executable: { value: command.executable }, args: { value: command.args }
  }) as typeof command
  const cases = [
    Object.create(command) as typeof command,
    hidden,
    { ...command, toJSON: () => directCommand(process.execPath, ['-e', 'process.stdout.write("changed")']) },
    { ...command, args: Object.assign([...command.args], { toJSON: () => ['-e', 'process.stdout.write("changed")'] }) }
  ]
  for (const run of [runProcess, runProcessSync]) {
    for (const value of cases) assert.equal((await run(value)).stdout, 'intended')
    await assert.rejects(Promise.resolve().then(() => run({
      get executable(): string { throw new Error('private command detail') }, args: []
    })), error => error instanceof ProcessFailure && error.kind === 'spawn' && !JSON.stringify(error.toJSON()).includes('private command detail'))
  }
})

test('process runners preserve captured working directory and environment options', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cave-process-options-')))
  const command = directCommand(process.execPath, ['-e', 'process.stdout.write(JSON.stringify([process.cwd(), process.env.CAVE_CAPTURE_TEST]))'])
  const env = { ...process.env, CAVE_CAPTURE_TEST: 'original' }
  try {
    for (const run of [runProcess, runProcessSync]) {
      let cwdReads = 0
      let envReads = 0
      const result = await run(command, {
        get cwd() { return ++cwdReads === 1 ? dir : process.cwd() },
        get env() { return ++envReads === 1 ? env : { ...env, CAVE_CAPTURE_TEST: 'changed' } }
      })
      assert.deepEqual(JSON.parse(result.stdout), [dir, 'original'])
      assert.equal(cwdReads, 1)
      assert.equal(envReads, 1)
      const hidden = Object.defineProperties({}, { cwd: { value: dir }, env: { value: env } })
      assert.deepEqual(JSON.parse((await run(command, hidden)).stdout), [dir, 'original'])
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('process runners preserve inherited environment entries without invoking toJSON', async () => {
  const command = directCommand(process.execPath, ['-e',
    'process.stdout.write(JSON.stringify([process.env.CAVE_INHERITED, process.env.CAVE_OWN, process.env.CAVE_HIDDEN]))'])
  for (const run of [runProcess, runProcessSync]) {
    let serializations = 0
    const env = Object.assign(Object.create({ CAVE_INHERITED: 'inherited café 😀' }), { CAVE_OWN: 'own' })
    Object.defineProperties(env, {
      CAVE_HIDDEN: { value: 'hidden' },
      toJSON: { value: () => { serializations++; return { CAVE_OWN: 'replaced' } } }
    })
    const result = await run(command, { env })
    assert.deepEqual(JSON.parse(result.stdout), ['inherited café 😀', 'own', null])
    assert.equal(serializations, 0)
  }
})

test('process cancellation and cleanup use the signal captured at launch', async () => {
  const command = directCommand(process.execPath, ['-e', 'setTimeout(() => {}, 250)'])
  for (const mode of ['getter', 'mutation']) {
    const controller = new AbortController()
    const other = new AbortController()
    let reads = 0
    const mutable = { signal: controller.signal }
    const options = mode === 'getter' ? {
      get signal() { return ++reads === 1 ? controller.signal : other.signal }
    } : mutable
    const running = runProcess(command, options)
    mutable.signal = other.signal
    const timer = mode === 'getter' ? setTimeout(() => controller.abort(), 50) : undefined
    try {
      if (mode === 'getter') await assert.rejects(running, error => error instanceof ProcessFailure && error.kind === 'aborted')
      else assert.equal((await running).code, 0)
      if (mode === 'getter') assert.equal(reads, 1)
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
      assert.equal(getEventListeners(other.signal, 'abort').length, 0)
    } finally { clearTimeout(timer) }
  }
})

test('process runners capture stdin once, including non-enumerable input', async () => {
  const command = directCommand(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'])
  for (const run of [runProcess, runProcessSync]) {
    let reads = 0
    const result = await run(command, {
      get input() { return ++reads === 1 ? 'original café 😀' : 'changed' }
    })
    assert.equal(result.stdout, 'original café 😀')
    assert.equal(reads, 1)
    const hidden = Object.defineProperty({}, 'input', { value: 'hidden input' })
    assert.equal((await run(command, hidden)).stdout, 'hidden input')
    await assert.rejects(Promise.resolve().then(() => run(command, Object.defineProperty({}, 'input', { value: { private: 'secret' } }))),
      error => error instanceof TypeError && error.message === 'input must be a string')
  }
})

test('strict stdout decoding rejects invalid bytes in asynchronous and synchronous runs', async () => {
  for (const run of [runProcess, runProcessSync]) {
    const invalid = directCommand(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0xff]))'])
    await assert.rejects(Promise.resolve().then(() => run(invalid, { strictStdoutUtf8: true })),
      error => error instanceof ProcessFailure && error.kind === 'stdout-encoding')
    await assert.rejects(Promise.resolve().then(() => run(invalid, Object.defineProperty({}, 'strictStdoutUtf8', { value: true }))),
      error => error instanceof ProcessFailure && error.kind === 'stdout-encoding')
    let reads = 0
    await assert.rejects(Promise.resolve().then(() => run(invalid, { get strictStdoutUtf8() { return ++reads === 1 } })),
      error => error instanceof ProcessFailure && error.kind === 'stdout-encoding')
    assert.equal(reads, 1)
    const ordinary = await run(invalid)
    assert.equal(ordinary.stdout, '�')
    const valid = await run(directCommand(process.execPath, ['-e', 'process.stdout.write("�café 😀")']), { strictStdoutUtf8: true })
    assert.equal(valid.stdout, '�café 😀')
    await assert.rejects(Promise.resolve().then(() => run(
      directCommand(process.execPath, ['-e', 'process.stdout.write("😀")']),
      { strictStdoutUtf8: true, maxStdoutBytes: 1 },
    )), error => error instanceof ProcessFailure && error.kind === 'stdout-limit')
  }
  const options = { strictStdoutUtf8: true }
  const pending = runProcess(directCommand(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0xff]))']), options)
  options.strictStdoutUtf8 = false
  await assert.rejects(pending, error => error instanceof ProcessFailure && error.kind === 'stdout-encoding')
})

test('process deadlines reject timer overflow before launching commands', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-process-deadline-'))
  try {
    const marker = join(dir, 'launched')
    const command = directCommand(process.execPath, ['-e',
      'require("node:fs").writeFileSync(process.argv[1], "launched")', marker])
    for (const run of [runProcess, runProcessSync]) {
      for (const timeoutMs of [2147483648, Number.MAX_SAFE_INTEGER]) {
        await assert.rejects(Promise.resolve().then(() => run(command, { timeoutMs })),
          /timeoutMs must be in 0\.\.2147483647/)
        assert.equal(existsSync(marker), false)
      }
      const result = await run(directCommand(process.execPath, ['-e', 'process.stdout.write("ok")']), { timeoutMs: 2147483647 })
      assert.equal(result.stdout, 'ok')
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

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
    const windows = shellCommand('node {script} {value}', { script, value }, 'win32')
    assert.equal(windows.executable, 'pwsh.exe')
    assert.equal(windows.args.at(-2), '-EncodedCommand')
    assert.equal(Buffer.from(windows.args.at(-1)!, 'base64').toString('utf16le'),
      [
        '$global:LASTEXITCODE = $null',
        `node '${script.replaceAll("'", "''")}' '${value.replaceAll("'", "''")}'`,
        '$caveSucceeded = $?',
        '$caveExitCode = $global:LASTEXITCODE',
        'if ($caveSucceeded) { exit 0 }',
        'if ($null -ne $caveExitCode) { exit $caveExitCode }',
        'exit 1'
      ].join('\n'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('both runners preserve split UTF-8 at exact byte capture limits', async () => {
  const text = 'żółw 🐢 café\n'
  const bytes = Buffer.byteLength(text)
  const command = directCommand(process.execPath, ['-e', `
    const { writeSync } = require('node:fs');
    (async () => {
      for (const byte of Buffer.from(process.argv[1])) {
        writeSync(1, Buffer.from([byte]));
        writeSync(2, Buffer.from([byte]));
        await new Promise(resolve => setTimeout(resolve, 3));
      }
    })();
  `, text])
  for (const run of [runProcess, runProcessSync]) {
    const result = await run(command, { maxStdoutBytes: bytes, maxStderrBytes: bytes })
    assert.deepEqual(result, { code: 0, signal: null, stdout: text, stderr: text })
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
      assert.equal(error.errorCode, 'ENOENT')
      assert.doesNotMatch(JSON.stringify(error.toJSON()), new RegExp(secret))
      return true
    }
  )
})

test('command getter failures redact arbitrary thrown values', async () => {
  const secret = 'private-command-getter'
  const failures = [null, undefined, secret, { code: secret }, {
    get code() { throw new Error(secret) }
  }]
  for (const run of [runProcess, runProcessSync]) {
    for (const failure of failures) {
      await assert.rejects(Promise.resolve().then(() => run({
        get executable(): string { throw failure }, args: []
      })), error => {
        assert.ok(error instanceof ProcessFailure)
        assert.equal(error.kind, 'spawn')
        assert.deepEqual(error.result, { code: null, signal: null, stdout: '', stderr: '' })
        assert.equal(error.errorCode, undefined)
        assert.doesNotMatch(JSON.stringify(error.toJSON()), new RegExp(secret))
        return true
      })
    }
  }
})

test('launch-option getter failures are redacted by both process runners', async () => {
  const secret = 'private-launch-option'
  const fail = (): never => { throw new Error(secret) }
  const cases = [
    { get cwd(): string { return fail() } },
    { get env(): NodeJS.ProcessEnv { return fail() } },
    { env: { get CAVE_PRIVATE(): string { return fail() } } }
  ]
  for (const run of [runProcess, runProcessSync]) {
    for (const options of cases) {
      await assert.rejects(Promise.resolve().then(() => run(directCommand(process.execPath), options)), error => {
        assert.ok(error instanceof ProcessFailure)
        assert.equal(error.kind, 'spawn')
        assert.deepEqual(error.result, { code: null, signal: null, stdout: '', stderr: '' })
        assert.doesNotMatch(JSON.stringify(error.toJSON()), new RegExp(secret))
        return true
      })
    }
  }
})

test('synchronous spawn validation failures are typed and redact sensitive values', async () => {
  const secret = 'private-spawn-value'
  const invalid = `${secret}\0suffix`
  const cases = [
    { command: directCommand(invalid), options: {} },
    { command: directCommand(process.execPath, [invalid]), options: {} },
    { command: directCommand(process.execPath), options: { cwd: invalid } },
    { command: directCommand(process.execPath), options: { env: { PRIVATE_VALUE: invalid } } }
  ]
  for (const run of [runProcess, runProcessSync]) {
    for (const { command, options } of cases) {
      await assert.rejects(Promise.resolve().then(() => run(command, options)), (error: unknown) => {
        assert.ok(error instanceof ProcessFailure)
        assert.equal(error.kind, 'spawn')
        assert.doesNotMatch(JSON.stringify(error.toJSON()), new RegExp(secret))
        assert.deepEqual(error.result, { code: null, signal: null, stdout: '', stderr: '' })
        return true
      })
    }
  }
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


test('explicit null process budgets reject before command access and allow corrected retries', async () => {
  for (const run of [runProcess, runProcessSync]) {
    for (const field of ['timeoutMs', 'maxStdoutBytes', 'maxStderrBytes']) {
      let reads = 0
      const command = { get executable() { reads += 1; return process.execPath }, args: ['-e', 'process.stdout.write("ok")'] }
      await assert.rejects(Promise.resolve().then(() => run(command, { [field]: null } as never)),
        new RegExp(`${field} must be a non-negative safe integer`))
      assert.equal(reads, 0, 'invalid budgets cannot start a process')
      const result = await run(command, { timeoutMs: 5000, maxStdoutBytes: 2, maxStderrBytes: 0 })
      assert.equal(result.stdout, 'ok')
      assert.equal(result.code, 0)
    }
  }
})


test('malformed UTF-8 validation modes reject before launch without coercion', async () => {
  for (const run of [runProcess, runProcessSync]) {
    let reads = 0
    const command = { get executable() { reads += 1; return process.execPath }, args: ['-e', 'process.stdout.write(Buffer.from([255]))'] }
    for (const value of [null, 'true', 'false', 0, 1, {}, { valueOf() { throw new Error('must not coerce') } }]) {
      let modeReads = 0
      await assert.rejects(Promise.resolve().then(() => run(command, {
        get strictStdoutUtf8() { modeReads += 1; return value }
      } as never)), /strictStdoutUtf8 must be a boolean/)
      assert.equal(modeReads, 1)
      assert.equal(reads, 0)
    }
    await assert.rejects(Promise.resolve().then(() => run(command, { strictStdoutUtf8: true })),
      error => error instanceof ProcessFailure && error.kind === 'stdout-encoding')
    assert.equal((await run(command, { strictStdoutUtf8: false })).stdout, '�')
  }
})


for (const failed of [false, true]) test(`process cleanup failures settle the runner and retain its outcome (failed=${failed})`, () => {
  const source = `
    import assert from 'node:assert/strict';
    import { getEventListeners } from 'node:events';
    import { runProcess, directCommand, ProcessFailure } from ${JSON.stringify(new URL('../src/process.ts', import.meta.url).href)};
    const controller = new AbortController();
    const cleanup = new Error('sensitive cleanup detail');
    const timerCleanup = new Error('sensitive timer detail');
    const clear = globalThis.clearTimeout;
    globalThis.clearTimeout = timer => { clear(timer); throw timerCleanup; };
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.removeEventListener = (...args) => { remove(...args); throw cleanup; };
    let caught;
    try {
      await runProcess(directCommand(process.execPath, ['-e', ${JSON.stringify(failed ? 'setInterval(() => {}, 1000)' : 'process.stdout.write("ok")')}]),
        { signal: controller.signal, timeoutMs: ${failed ? 50 : 5000} });
    } catch (error) { caught = error; }
    globalThis.clearTimeout = clear;
    assert.ok(caught);
    assert.ok(!caught.message.includes('sensitive'));
    if (${failed}) {
      assert.ok(caught instanceof ProcessFailure);
      assert.equal(caught.kind, 'timeout');
      assert.ok(caught.cause instanceof AggregateError);
      assert.deepEqual(caught.cause.errors, [timerCleanup, cleanup]);
    } else {
      assert.ok(caught instanceof AggregateError);
      assert.deepEqual(caught.errors, [timerCleanup, cleanup]);
    }
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.equal((await runProcess(directCommand(process.execPath, ['-e', 'process.stdout.write("retry")']))).stdout, 'retry');
    process.stdout.write('verified');
  `
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', source], {
    encoding: 'utf8', timeout: 10000
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'verified')
})

for (const cleanupFails of [false, true]) test(`process startup failure terminates its child and permits retry (cleanupFails=${cleanupFails})`, () => {
  const source = `
    import assert from 'node:assert/strict';
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { getEventListeners, once } from 'node:events';
    import { runProcess, directCommand, ProcessFailure } from ${JSON.stringify(new URL('../src/process.ts', import.meta.url).href)};
    const originalSpawn = cp.spawn;
    let child;
    cp.spawn = (...args) => { child = originalSpawn(...args); return child; };
    syncBuiltinESMExports();
    const controller = new AbortController();
    const add = controller.signal.addEventListener.bind(controller.signal);
    controller.signal.addEventListener = (...args) => { add(...args); throw new Error('sensitive startup detail'); };
    const cleanup = new Error('sensitive cleanup detail');
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.removeEventListener = (...args) => { remove(...args); if (${cleanupFails}) throw cleanup; };
    let caught;
    try {
      try { await runProcess(directCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)']),
        { signal: controller.signal, timeoutMs: 0 }); } catch (error) { caught = error; }
      assert.ok(caught instanceof ProcessFailure);
      assert.equal(caught.kind, 'spawn');
      assert.ok(!caught.message.includes('sensitive'));
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
      if (${cleanupFails}) assert.deepEqual(caught.cause.errors, [cleanup]);
      if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([once(child, 'exit'), new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('child still running after startup failure')), 2000);
          timer.unref();
        })]);
      }
      assert.ok(child.exitCode !== null || child.signalCode !== null);
    } finally {
      cp.spawn = originalSpawn;
      syncBuiltinESMExports();
      if (child && child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close');
        child.kill('SIGKILL');
        await closed;
      }
    }
    assert.equal((await runProcess(directCommand(process.execPath, ['-e', 'process.stdout.write("retry")']))).stdout, 'retry');
    process.stdout.write('verified');
  `
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', source], {
    encoding: 'utf8', timeout: 10000
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'verified')
})
