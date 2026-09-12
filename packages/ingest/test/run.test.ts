import { test } from 'node:test'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import * as assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { open } from '@cavelang/store'
import { Files, run, runShellAgent, selectBatches, writeMcpConfig } from '@cavelang/ingest'

const withDir = (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-run-'))
  return body(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('strict ingestion publishes only to the store selected when the run starts', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'source.md'), 'source material')
    const target = open(join(dir, 'target.db'))
    const other = open(join(dir, 'other.db'))
    try {
      target.ingest('target IS retained')
      other.ingest('other IS retained')
      const otherBefore = other.exportText({ tx: true, maxSensitivity: 'restricted' })
      const options = {
        db: join(dir, 'target.db'), store: target, patterns: ['source.md'], cwd: dir,
        mode: 'stdout' as const, embed: true,
        agent: async () => {
          await Promise.resolve()
          options.store = other
          return 'extracted IS knowledge'
        }
      }
      const report = await run(options)
      assert.equal(report.applied, true)
      assert.equal(report.added, 1)
      assert.ok(target.currentBeliefs().some(row => row.subject === 'extracted'))
      assert.equal(other.exportText({ tx: true, maxSensitivity: 'restricted' }), otherBefore)
    } finally { target.close(); other.close() }
  }))

test('source selection retains its validated batch size across URL fetching', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'local.md'), 'local material')
    const store = open()
    try {
      const options = {
        db: ':memory:', store, cwd: dir, patterns: ['local.md', 'https://example.com/source'],
        batchSize: 1,
        fetchImpl: async () => {
          await Promise.resolve()
          options.batchSize = 2
          return new Response('remote material', { headers: { 'content-type': 'text/plain' } })
        }
      }
      const selected = await selectBatches(store, options)
      assert.equal(selected.selection.files.length, 2)
      assert.equal(selected.batches.length, 2)
      assert.ok(selected.batches.every(batch => batch.length === 1))
    } finally { store.close() }
  }))

test('source manifests retain batch numbers and shared failures for multi-file batches', () =>
  withDir(async dir => {
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) writeFileSync(join(dir, `${name}.md`), name)
    for (const policy of ['strict', 'lenient'] as const) {
      const store = open()
      try {
        let calls = 0
        const report = await run({
          db: ':memory:', store, cwd: dir, patterns: ['*.md'], batchSize: 2,
          mode: 'stdout', policy,
          agent: async () => {
            calls++
            if (calls === 2) throw new Error('second batch failed')
            return `batch-${calls} IS accepted`
          }
        })
        assert.deepEqual(report.sources.map(source => [source.path, source.status, source.batch]), [
          ['a.md', 'accepted', 1], ['b.md', 'accepted', 1],
          ['c.md', 'rejected', 2], ['d.md', 'rejected', 2],
          ['e.md', policy === 'strict' ? 'not-run' : 'accepted', policy === 'strict' ? undefined : 3],
          ['f.md', policy === 'strict' ? 'not-run' : 'accepted', policy === 'strict' ? undefined : 3]
        ])
        assert.equal(report.sources[2]!.note, 'second batch failed')
        assert.equal(report.sources[3]!.note, 'second batch failed')
        assert.equal(calls, policy === 'strict' ? 2 : 3)
        assert.equal(report.applied, policy === 'lenient')
        assert.equal(report.failed, 1, 'two rejected sources share one failed batch')
        assert.equal(report.added, policy === 'strict' ? 0 : 2)
        const retry = await selectBatches(store, {
          db: ':memory:', store, cwd: dir, patterns: ['*.md'], batchSize: 2
        })
        assert.deepEqual(retry.selection.files.map(file => file.path),
          policy === 'strict' ? ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md'] : ['c.md', 'd.md'])
        assert.deepEqual(retry.selection.skipped,
          policy === 'strict' ? [] : ['a.md', 'b.md', 'e.md', 'f.md'])
      } finally { store.close() }
    }
  }))

test('shell-agent forwarding retains an already-aborted signal', async () => {
  const signal = AbortSignal.abort(new Error('cancel agent before launch'))
  let reads = 0
  const result = await runShellAgent('node -e "process.stdout.write(\'unexpected\')"', '', {}, 10, process.cwd(), {
    get signal() { return ++reads === 1 ? signal : undefined }
  })
  assert.equal(result.code, null)
  assert.equal(result.stdout, '')
  assert.ok(result.error)
  assert.equal(reads, 1)
})

test('shell-agent forwarding retains captured output limits', async () => {
  for (const [stream, field] of [['stdout', 'maxStdoutBytes'], ['stderr', 'maxStderrBytes']] as const) {
    let reads = 0
    const result = await runShellAgent(`node -e "process.${stream}.write('abc')"`, '', {}, 10, process.cwd(), {
      get [field]() { return ++reads === 1 ? 1 : 100 }
    })
    assert.equal(result.code, null)
    assert.ok(result.error?.includes(stream), result.error)
    assert.equal(result.stdout, stream === 'stdout' ? 'a' : '')
    assert.equal(reads, 1)
  }
})

test('invalid ingestion policies fail before agent work or target writes', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'source.md'), 'source material')
    const store = open()
    try {
      store.ingest('retained IS knowledge')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      let calls = 0
      const options = {
        db: ':memory:', store, cwd: dir, patterns: ['source.md'], mode: 'stdout' as const,
        agent: async () => { calls++; return 'extracted IS knowledge' }
      }
      for (const policy of ['', 'strcit', null, true, 1, {}]) {
        await assert.rejects(run({ ...options, policy: policy as never }), /policy must be strict or lenient/)
        assert.equal(calls, 0)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      const result = await run({ ...options, policy: 'strict' })
      assert.equal(result.applied, true)
      assert.equal(result.added, 1)
      assert.equal(calls, 1)
    } finally { store.close() }
  }))

test('invalid ingestion modes cannot certify a source without extracting claims', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'source.md'), 'source material')
    const store = open()
    try {
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      let calls = 0
      const options = {
        db: ':memory:', store, cwd: dir, patterns: ['source.md'],
        agent: async () => { calls++; return 'extracted IS knowledge' }
      }
      for (const mode of ['', 'stdotu', null, true, 1, {}]) {
        await assert.rejects(run({ ...options, mode: mode as never }), /mode must be mcp or stdout/)
        assert.equal(calls, 0)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      const result = await run({ ...options, mode: 'stdout' })
      assert.equal(result.added, 1)
      assert.equal(calls, 1)
      assert.ok(store.currentBeliefs().some(row => row.subject === 'extracted'))
    } finally { store.close() }
  }))

test('runShellAgent rejects malformed prompt Unicode before sending stdin', async () => {
  const command = 'node -e "process.stdin.pipe(process.stdout)"'
  for (const surrogate of ['\ud800', '\udc00']) {
    const result = await runShellAgent(command, 'claim ' + surrogate, {}, 10, process.cwd())
    assert.equal(result.code, null)
    assert.equal(result.stdout, '')
    assert.equal(result.error, 'agent prompt must contain well-formed Unicode')
  }
  const prompt = '�café 😀'
  const recovered = await runShellAgent(command, prompt, {}, 10, process.cwd())
  assert.equal(recovered.code, 0, recovered.error)
  assert.equal(recovered.stdout, prompt)
})

test('invalid UTF-8 instruction files fail before calling the agent and recover after correction', () =>
  withDir(async dir => {
    const instructions = join(dir, 'instructions.md')
    writeFileSync(instructions, Buffer.concat([Buffer.from('Follow '), Buffer.from([0xff])]))
    writeFileSync(join(dir, 'source.md'), 'source')
    const store = open()
    let calls = 0
    try {
      const options = {
        db: ':memory:', store, cwd: dir, patterns: ['source.md'], instructions, mode: 'stdout' as const,
        agent: async (prompt: string) => {
          calls++
          assert.ok(prompt.includes('Follow �café 😀'))
          return 'agent IS instructed'
        },
      }
      await assert.rejects(run(options), /instructions\.md: invalid UTF-8 instructions/)
      assert.equal(calls, 0)
      assert.equal(store.currentBeliefs().length, 0)
      writeFileSync(instructions, 'Follow �café 😀')
      const recovered = await run(options)
      assert.equal(recovered.failed, 0)
      assert.equal(recovered.added, 1)
      assert.equal(calls, 1)
    } finally { store.close() }
  }))

test('ingestion API rejects invalid timeouts before reading inputs or calling agents', async () => {
  const store = open()
  try {
    for (const timeoutSeconds of [null as unknown as number, 0, -1, NaN, Infinity, 0.0001, 2147483.648]) {
      const options = {
        store, db: ':memory:', patterns: [], files: ['/missing-timeout-input'], timeoutSeconds,
        agent: async () => { assert.fail('invalid options must not call an agent') }
      }
      await assert.rejects(run(options), /timeout must resolve/)
      await assert.rejects(selectBatches(store, options), /timeout must resolve/)
    }
    assert.equal(store.currentBeliefs().length, 0)
    const result = await runShellAgent('echo ready', '', {}, 1.001, process.cwd())
    assert.equal(result.code, 0)
    assert.match(result.stdout, /ready/)
  } finally { store.close() }
})

test('MCP configuration write failures clean owned directories and preserve caller directories', async t => {
  const store = open()
  const callerDir = mkdtempSync(join(tmpdir(), 'cave-config-owner-'))
  let attempted = ''
  const write = fs.writeFileSync
  const mock = t.mock.method(fs, 'writeFileSync', ((path, ...args) => {
    if (String(path).endsWith('cave-mcp.json')) {
      attempted = String(path)
      throw new Error('configuration disk failure')
    }
    return Reflect.apply(write, fs, [path, ...args])
  }) as typeof fs.writeFileSync)
  syncBuiltinESMExports()
  try {
    assert.throws(() => writeMcpConfig(':memory:'), /configuration disk failure/)
    assert.equal(existsSync(dirname(attempted)), false)
    assert.throws(() => writeMcpConfig(':memory:', { dir: callerDir }), /configuration disk failure/)
    assert.equal(existsSync(callerDir), true)
    const sentinel = join(callerDir, 'keep.txt')
    writeFileSync(sentinel, 'caller-owned content')
    let reads = 0
    assert.throws(() => writeMcpConfig(':memory:', Object.defineProperty({}, 'dir', {
      get: () => reads++ === 0 ? callerDir : undefined
    })), /configuration disk failure/)
    assert.equal(existsSync(callerDir), true)
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'caller-owned content')
    assert.equal(reads, 1)
    reads = 0
    assert.throws(() => writeMcpConfig(':memory:', Object.defineProperty({}, 'dir', {
      get: () => reads++ === 0 ? undefined : callerDir
    })), /configuration disk failure/)
    assert.equal(existsSync(dirname(attempted)), false)
    assert.equal(reads, 1)
    assert.throws(() => writeMcpConfig(':memory:', Object.defineProperty({}, 'dir', { value: null })), /configuration disk failure/)
    assert.equal(existsSync(dirname(attempted)), false)
    await assert.rejects(run({
      store, db: ':memory:', patterns: [], policy: 'lenient', agent: 'unused {mcp-config}'
    }), /configuration disk failure/)
    assert.equal(existsSync(dirname(attempted)), false)
  } finally {
    mock.mock.restore()
    syncBuiltinESMExports()
    if (attempted && dirname(attempted) !== callerDir) rmSync(dirname(attempted), { recursive: true, force: true })
    rmSync(callerDir, { recursive: true, force: true })
    store.close()
  }
})

test('path-based source changes reject the batch without recording a digest', () =>
  withDir(async dir => {
    for (const policy of ['strict', 'lenient'] as const) {
      for (const mode of ['stdout', 'mcp'] as const) {
        for (const change of ['replace', 'remove'] as const) {
          const path = join(dir, 'source.md')
          writeFileSync(path, 'original source')
          const db = join(dir, `${policy}-${mode}-${change}.db`)
          const store = open(db)
          try {
            const report = await run({
              db, store, cwd: dir, patterns: ['source.md'], policy, mode,
              agent: async (_prompt, _files, context) => {
                if (mode === 'mcp') {
                  const writer = open(context.db)
                  try { writer.ingest('direct IS written') } finally { writer.close() }
                }
                if (change === 'replace') writeFileSync(path, 'replacement source')
                else rmSync(path)
                return 'extracted IS written'
              }
            })
            assert.equal(report.failed, 1)
            assert.equal(report.sources[0]!.status, 'rejected')
            assert.match(report.batches[0]!.problems.join(' '), /source.md.*(?:changed|read)/)
            assert.equal(store.currentBeliefs().some(row => row.attribute === 'ingest-digest'), false)
            assert.equal(store.currentBeliefs().some(row => row.subject === 'extracted'), false)
            assert.equal(store.currentBeliefs().some(row => row.subject === 'direct'), policy === 'lenient' && mode === 'mcp')
          } finally { store.close() }
        }
      }
    }
  }))

test('changed later path batches skip agent calls and follow strict or lenient continuation', () =>
  withDir(async dir => {
    for (const policy of ['strict', 'lenient'] as const) {
      for (const name of ['a', 'b', 'c']) writeFileSync(join(dir, `${name}.md`), name)
      const store = open()
      const calls: string[] = []
      try {
        const report = await run({
          db: ':memory:', store, cwd: dir, patterns: ['*.md'], batchSize: 1,
          mode: 'stdout', policy,
          agent: async (_prompt, files) => {
            calls.push(files[0]!)
            if (files[0] === 'a.md') writeFileSync(join(dir, 'b.md'), 'changed')
            return `${files[0] === 'a.md' ? 'first' : 'last'} IS accepted`
          }
        })
        assert.equal(report.failed, 1)
        assert.deepEqual(calls, policy === 'strict' ? ['a.md'] : ['a.md', 'c.md'])
        assert.equal(report.sources.find(source => source.path === 'b.md')!.status, 'rejected')
        assert.equal(report.sources.find(source => source.path === 'c.md')!.status, policy === 'strict' ? 'not-run' : 'accepted')
        assert.equal(Files.isIngested(store, 'b.md', Files.digestOf('b')), false)
        assert.equal(store.currentBeliefs().some(row => row.subject === 'first'), policy === 'lenient')
      } finally { store.close() }
    }
  }))

test('path-based ingestion detects raw-byte drift even when lossy text would be identical', () =>
  withDir(async dir => {
    const path = join(dir, 'source.bin')
    writeFileSync(path, Buffer.from([0xff]))
    const store = open()
    try {
      const report = await run({
        db: ':memory:', store, cwd: dir, patterns: ['*.bin'], mode: 'stdout',
        agent: async () => {
          writeFileSync(path, Buffer.from([0xfe]))
          return 'wrong IS accepted'
        },
      })
      assert.equal(report.failed, 1)
      assert.match(report.batches[0]!.problems.join(' '), /source changed/)
      assert.equal(store.currentBeliefs().some(row => row.subject === 'wrong' || row.attribute === 'ingest-digest'), false)
    } finally { store.close() }
  }))

test('embedded batches retain the content whose digest was selected when later files change', () =>
  withDir(async dir => {
    for (const policy of ['strict', 'lenient'] as const) {
      writeFileSync(join(dir, 'a.md'), 'first source')
      writeFileSync(join(dir, 'b.md'), 'original second source')
      const store = open()
      try {
        const report = await run({
          db: ':memory:', store, cwd: dir, patterns: ['*.md'], batchSize: 1,
          embed: true, mode: 'stdout', policy,
          agent: async (prompt, files) => {
            if (files[0] === 'a.md') {
              writeFileSync(join(dir, 'b.md'), 'replacement second source')
              return 'first IS accepted'
            }
            assert.ok(prompt.includes('original second source'))
            assert.ok(!prompt.includes('replacement second source'))
            return 'second IS accepted'
          }
        })
        assert.equal(report.failed, 0)
        assert.equal(Files.isIngested(store, 'b.md', Files.digestOf('original second source')), true)
        const next = await selectBatches(store, { db: ':memory:', store, cwd: dir, patterns: ['*.md'], embed: true })
        assert.deepEqual(next.selection.skipped, ['a.md'])
        assert.deepEqual(next.selection.files.map(file => file.path), ['b.md'])
      } finally { store.close() }
    }
  }))

test('cancellation discards strict staging and preserves only earlier lenient batches', () =>
  withDir(async dir => {
    for (const name of ['a', 'b', 'c']) writeFileSync(join(dir, `${name}.md`), name)
    for (const policy of ['strict', 'lenient'] as const) {
      const store = open()
      const controller = new AbortController()
      const reason = new Error('stop ingestion')
      let calls = 0
      try {
        await assert.rejects(run({
          db: ':memory:', store, cwd: dir, patterns: ['*.md'], batchSize: 1,
          mode: 'stdout', policy, signal: controller.signal,
          agent: async (_prompt, _files, context) => {
            assert.equal(context.signal, controller.signal)
            calls++
            if (calls === 2) controller.abort(reason)
            return `${calls === 1 ? 'first' : 'later'} IS accepted`
          }
        }), error => error === reason)
        assert.equal(calls, 2)
        assert.equal(store.currentBeliefs().filter(row => row.subject === 'first').length, policy === 'strict' ? 0 : 1)
        assert.equal(store.currentBeliefs().filter(row => row.subject === 'later').length, 0)
        assert.equal(store.currentBeliefs().filter(row => row.attribute === 'ingest-digest').length, policy === 'strict' ? 0 : 1)
      } finally { store.close() }
    }
  }))

test('cancelled direct agent writes respect strict staging and lenient ownership', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'source.md'), 'source')
    for (const policy of ['strict', 'lenient'] as const) {
      const db = join(dir, `${policy}.db`)
      const store = open(db)
      store.ingest('baseline IS retained')
      const controller = new AbortController()
      const reason = new Error('cancel direct writer')
      let agentDb = ''
      try {
        await assert.rejects(run({
          db, store, cwd: dir, patterns: ['source.md'], policy, signal: controller.signal,
          agent: async (_prompt, _files, context) => {
            agentDb = context.db
            const writer = open(agentDb)
            try { writer.ingest('direct-write IS recorded') } finally { writer.close() }
            controller.abort(reason)
            throw reason
          }
        }), error => error === reason)
        assert.equal(store.currentBeliefs().filter(row => row.subject === 'baseline').length, 1)
        assert.equal(store.currentBeliefs().filter(row => row.subject === 'direct-write').length, policy === 'strict' ? 0 : 1)
        assert.equal(store.currentBeliefs().filter(row => row.attribute === 'ingest-digest').length, 0)
        if (policy === 'strict') {
          assert.notEqual(agentDb, db)
          assert.equal(existsSync(agentDb), false)
        } else {
          assert.equal(agentDb, db)
          assert.equal(existsSync(agentDb), true)
        }
      } finally { store.close() }
    }
  }))

test('invalid batch sizes fail before local or remote source selection', async () => {
  const store = open()
  try {
    for (const batchSize of [null as unknown as number, 0, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const options = {
        db: ':memory:', store, patterns: ['https://k.test/source'],
        files: ['missing-file-that-must-not-be-read'], batchSize,
        fetchImpl: async () => { assert.fail('must not fetch') }
      }
      await assert.rejects(selectBatches(store, options), /batch size must be a positive safe integer/)
      await assert.rejects(run(options), /batch size must be a positive safe integer/)
    }
  } finally { store.close() }
})

test('pre-cancelled ingestion does not select sources or call agents', async () => {
  const store = open()
  const reason = new Error('already stopped')
  try {
    await assert.rejects(run({
      db: ':memory:', store, patterns: ['https://k.test/source'], signal: AbortSignal.abort(reason),
      fetchImpl: async () => { assert.fail('must not fetch') },
      agent: async () => { assert.fail('must not call agent') }
    }), error => error === reason)
  } finally { store.close() }
})

test('cancellation reaches pending URL requests and prevents agent calls', async () => {
  const store = open()
  const controller = new AbortController()
  const reason = new Error('stop URL fetch')
  let receivedSignal: AbortSignal | null | undefined
  try {
    await assert.rejects(run({
      db: ':memory:', store, patterns: ['https://k.test/source'], signal: controller.signal,
      fetchImpl: async (_url, init) => {
        receivedSignal = init.signal
        assert.ok(receivedSignal)
        return new Promise((_resolve, reject) => {
          receivedSignal!.addEventListener('abort', () => reject(receivedSignal!.reason), { once: true })
          controller.abort(reason)
        })
      },
      agent: async () => { assert.fail('must not call agent') }
    }), error => error === reason)
    assert.equal(receivedSignal?.aborted, true)
  } finally { store.close() }
})

test('stdout mode with a function agent: extraction lands, digests recorded, rerun skips', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'auth.md'), 'The auth middleware uses JWT tokens.')
    writeFileSync(join(dir, 'billing.md'), 'Billing talks to stripe.')
    const store = open()
    const prompts: string[] = []
    const agent = async (prompt: string): Promise<string> => {
      prompts.push(prompt)
      return 'Here is the knowledge:\n```cave\nauth/middleware USES jwt\nbilling USES stripe\n```'
    }
    const options = {
      db: ':memory:', store, patterns: ['*.md'], cwd: dir,
      mode: 'stdout' as const, agent, batchSize: 8, embed: true
    }
    const report = await run(options)
    assert.equal(report.matched, 2)
    assert.equal(report.batches.length, 1)
    assert.equal(report.added, 2)
    assert.equal(report.failed, 0)
    assert.match(prompts[0]!, /The auth middleware uses JWT tokens\./, 'embed inlines contents')
    const extracted = store.currentBeliefs().filter(row => row.verb === 'USES')
    assert.equal(extracted.length, 2)
    // Actor provenance (spec §9.5): stdout-mode appends carry the stable
    // ingestion-surface stamp, so a later re-extraction stays in the same
    // belief series.
    for (const row of extracted) {
      assert.deepEqual(store.toClaim(row).contexts, ['src:ingest'])
    }

    const again = await run(options)
    assert.equal(again.batches.length, 0, 'unchanged files are skipped')
    assert.deepEqual(again.skipped.length, 2)
    store.close()
  }))

test('stdout re-ingest of a revised source supersedes the previous belief (BUGS.md stdout-source-identity)', () =>
  withDir(async dir => {
    const doc = join(dir, 'service.md')
    writeFileSync(doc, 'The service timeout is 3000ms.')
    const store = open()
    const options = {
      db: ':memory:', store, patterns: ['*.md'], cwd: dir,
      mode: 'stdout' as const, embed: true
    }
    const first = await run({ ...options, agent: async () => 'service HAS timeout: 3000ms' })
    assert.equal(first.added, 1)
    // The source is revised: the agent re-extracts the same fact with a
    // new value. The stamp must not depend on content, or the revised
    // claim lands under a different claim key (spec §9.2) and both the
    // old and the new belief stay current.
    writeFileSync(doc, 'The service timeout is 5000ms.')
    const second = await run({ ...options, agent: async () => 'service HAS timeout: 5000ms' })
    assert.equal(second.batches.length, 1, 'the revised file is re-ingested')
    const current = store.currentBeliefs().filter(row => row.attribute === 'timeout')
    assert.equal(current.length, 1, 'the revision supersedes — old and new must not both be current')
    assert.equal(current[0]!.value_num, 5000)
    store.close()
  }))

test('files are literal paths — a name with glob metacharacters selects that file, not its expansion (BUGS.md eval-glob-escape)', () =>
  withDir(async dir => {
    // As a pattern, `[draft]` is a character class matching the decoy
    // `notesd.md` and never the literal file.
    writeFileSync(join(dir, 'notes[draft].md'), 'The real draft notes.')
    writeFileSync(join(dir, 'notesd.md'), 'A decoy the character class matches.')
    const store = open()
    const prompts: string[] = []
    const options = {
      db: ':memory:', store, patterns: [], files: ['notes[draft].md'], cwd: dir,
      mode: 'stdout' as const, embed: true
    }
    const report = await run({
      ...options,
      agent: async (prompt: string) => {
        prompts.push(prompt)
        return 'notes HAS status: draft'
      }
    })
    assert.equal(report.matched, 1)
    assert.deepEqual(report.batches[0]!.files, ['notes[draft].md'])
    assert.match(prompts[0]!, /The real draft notes\./)
    assert.equal(report.added, 1)
    // Digest bookkeeping treats literal files like any other selection.
    const again = await run({
      ...options,
      agent: async (): Promise<string> => { throw new Error('agent must not run for an ingested source') }
    })
    assert.deepEqual(again.skipped, ['notes[draft].md'])
    // A missing literal path is an error, unlike an unmatched pattern.
    await assert.rejects(run({ ...options, files: ['missing.md'], agent: async () => '' }))
    store.close()
  }))

test('files merge with pattern expansion, deduplicated and sorted', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'a.md'), 'a')
    writeFileSync(join(dir, 'b.md'), 'b')
    const store = open()
    const report = await run({
      db: ':memory:', store, patterns: ['*.md'], files: ['b.md'], cwd: dir,
      mode: 'stdout', agent: async () => 'topic/files CONTAINS both'
    })
    assert.equal(report.matched, 2, 'b.md is selected once')
    assert.deepEqual(report.batches[0]!.files, ['a.md', 'b.md'])
    store.close()
  }))

test('context grows between batches — later prompts see earlier extractions', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'a.md'), 'a')
    writeFileSync(join(dir, 'b.md'), 'b')
    const store = open()
    const prompts: string[] = []
    const report = await run({
      db: ':memory:', store, patterns: ['*.md'], cwd: dir,
      mode: 'stdout', batchSize: 1,
      agent: async prompt => {
        prompts.push(prompt)
        return `topic/ingested CONTAINS file-${prompts.length}`
      }
    })
    assert.equal(report.batches.length, 2)
    assert.doesNotMatch(prompts[0]!, /Existing knowledge/, 'first batch sees the empty store')
    assert.match(prompts[1]!, /topic\/ingested/, 'second batch sees batch-one claims')
    store.close()
  }))

test('later ingestion batches receive current values without superseded or retracted context', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'auth.first.md'), 'first source')
    writeFileSync(join(dir, 'auth.second.md'), 'second source')
    for (const policy of ['strict', 'lenient'] as const) {
      const store = open()
      try {
        store.ingest('auth HAS provider: legacy @src:ingest\nauth USES password @src:ingest')
        const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        let calls = 0
        const report = await run({
          db: ':memory:', store, patterns: ['auth.*.md'], cwd: dir,
          mode: 'stdout', batchSize: 1, policy, embed: true,
          agent: async prompt => {
            calls++
            if (policy === 'strict') assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
            if (calls === 1) {
              assert.match(prompt, /auth HAS provider: legacy/)
              return 'auth HAS provider: modern\nauth USES password @ 0%'
            }
            assert.match(prompt, /auth HAS provider: modern/)
            assert.doesNotMatch(prompt, /legacy|password/)
            return 'review IS complete'
          }
        })
        assert.equal(calls, 2)
        assert.equal(report.failed, 0)
        assert.equal(report.applied, true)
        assert.equal(report.added, 3)
        assert.ok(store.currentBeliefs().some(row => row.subject === 'auth' && row.value_text === 'modern'))
        assert.ok(store.currentBeliefs().some(row => row.subject === 'auth' && row.object === 'password' && row.conf === 0))
        assert.ok(store.exportText({ tx: true, maxSensitivity: 'restricted' }).includes('legacy'))
      } finally { store.close() }
    }
  }))

test('shell agent template: stdin prompt, {prompt-file} and {db} substitution', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'notes.md'), 'notes')
    const store = open()
    // The fake agent emits a claim only after verifying it received the
    // prompt on stdin AND via {prompt-file}, with {db} substituted.
    // Placeholders stay bare — substituted values arrive shell-quoted.
    const agent =
      'grep -q "Files to ingest" - && grep -q "Files to ingest" {prompt-file} && test -n {db} && echo "shell/agent USES stdin"'
    const report = await run({
      db: join(dir, 'k.db'), store, patterns: ['notes.md'], cwd: dir,
      mode: 'stdout', agent
    })
    assert.equal(report.failed, 0, JSON.stringify(report.batches))
    assert.equal(report.added, 1)
    const [claim] = store.currentBeliefs().filter(row => row.verb === 'USES')
    assert.equal(claim!.subject, 'shell/agent')
    store.close()
  }))

test('runShellAgent shell-quotes substituted values — spaces, quotes and $() arrive verbatim', () =>
  withDir(async dir => {
    const echoArg = 'node -e "process.stdout.write(process.argv[1])" {db}'
    // A hostile value: spaces plus a command substitution. Unquoted, the
    // shell would run `touch` and split the path into two arguments.
    const marker = join(dir, 'injected')
    const hostile = join(dir, `knowledge base$(touch ${marker}).db`)
    const injected = await runShellAgent(echoArg, '', { db: hostile }, 10, dir)
    assert.equal(injected.code, 0)
    assert.equal(injected.stdout, hostile, 'the value lands as one verbatim argument')
    assert.ok(!existsSync(marker), 'substituted values are never shell-evaluated')
    // A single quote in the value exercises the quote-escaping itself.
    const quoted = join(dir, "it's a kb.db")
    const result = await runShellAgent(echoArg, '', { db: quoted }, 10, dir)
    assert.equal(result.code, 0)
    assert.equal(result.stdout, quoted)
  }))

test('shell agent run: a db path with spaces stays one argument', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'notes.md'), 'notes')
    const db = join(dir, 'knowledge base.db')
    writeFileSync(db, '')
    const store = open()
    const report = await run({
      db, store, patterns: ['notes.md'], cwd: dir,
      mode: 'stdout', agent: 'test -f {db} && echo "db/path USES spaces"'
    })
    assert.equal(report.failed, 0, JSON.stringify(report.batches))
    assert.equal(report.added, 1)
    store.close()
  }))

test('failing shell agent: batch reported, digests NOT recorded, retried next run', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'x.md'), 'x')
    const store = open()
    const failing = await run({
      db: ':memory:', store, patterns: ['*.md'], cwd: dir,
      mode: 'stdout', agent: 'exit 3'
    })
    assert.equal(failing.failed, 1)
    assert.match(failing.batches[0]!.note!, /exited with 3/)
    const retry = await run({
      db: ':memory:', store, patterns: ['*.md'], cwd: dir,
      mode: 'stdout', agent: 'echo "x IS recorded"'
    })
    assert.equal(retry.batches.length, 1, 'failed files stay eligible')
    assert.equal(retry.added, 1)
    store.close()
  }))

for (const ending of ['\n', '\r\n', '\r']) test(`mcp mode reports the database delta and final output line: ${JSON.stringify(ending)}`, () =>
  withDir(async dir => {
    const db = join(dir, 'k.db')
    writeFileSync(join(dir, 'doc.md'), 'doc')
    const seed = open(db)
    seed.close()
    const store = open(db)
    const report = await run({
      db, store, patterns: ['doc.md'], cwd: dir,
      mode: 'mcp',
      // Simulates an MCP-connected agent: writes through its own connection.
      agent: async (_prompt, _files, context) => {
        const external = open(context.db)
        external.ingest('doc/topic CONTAINS important-fact')
        external.close()
        return ['processing source', 'done: 1', ''].join(ending)
      }
    })
    assert.equal(report.added, 1)
    assert.equal(report.batches[0]!.note, 'done: 1')
    store.close()
  }))

test('writeMcpConfig points a client at cave mcp for the database', () =>
  withDir(async dir => {
    const path = writeMcpConfig(join(dir, 'k.db'), { dir })
    const config = JSON.parse(String(await import('node:fs').then(fs => fs.readFileSync(path, 'utf8'))))
    const cave = config.mcpServers.cave
    assert.equal(cave.command, process.execPath)
    assert.match(cave.args.join(' '), /bin\.ts --db .*k\.db/)
    assert.ok(!cave.args.includes('--no-prelude'))

    const bare = writeMcpConfig(join(dir, 'k.db'), { dir, noPrelude: true })
    const bareConfig = JSON.parse(String(await import('node:fs').then(fs => fs.readFileSync(bare, 'utf8'))))
    assert.ok(bareConfig.mcpServers.cave.args.includes('--no-prelude'))
  }))

test('strict stdout problems reject the whole run and leave claims and digests untouched', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'm.md'), 'm')
    const store = open()
    const report = await run({
      db: ':memory:', store, patterns: ['*.md'], cwd: dir,
      mode: 'stdout',
      agent: async () => 'good USES claim\nthis is not cave\n'
    })
    assert.equal(report.added, 0)
    assert.equal(report.applied, false)
    assert.equal(report.batches[0]!.problems.length, 1)
    assert.equal(report.sources[0]!.status, 'rejected')
    assert.equal(store.currentBeliefs().length, 0)
    store.close()
  }))

test('lenient parse problems keep valid lines but withhold digests for retry (BUGS.md partial-ingest-digests)', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'p.md'), 'p')
    const store = open()
    const options = {
      db: ':memory:', store, patterns: ['*.md'], cwd: dir,
      mode: 'stdout' as const, policy: 'lenient' as const
    }
    const partial = await run({ ...options, agent: async () => 'good USES claim\nthis is not cave\n' })
    assert.equal(partial.added, 1, 'valid lines still land (spec §1.6)')
    assert.equal(partial.batches[0]!.problems.length, 1)
    // The extraction may be incomplete: the unchanged source must stay
    // eligible, or the partial result freezes until the file changes.
    const retry = await run({ ...options, agent: async () => 'good USES claim\nrest CONTAINS extraction' })
    assert.equal(retry.batches.length, 1, 'a problem batch must not mark its sources ingested')
    assert.equal(retry.batches[0]!.problems.length, 0)
    // A clean extraction records digests as usual — the third run skips.
    const third = await run({
      ...options,
      agent: async (): Promise<string> => { throw new Error('agent must not run for an ingested source') }
    })
    assert.equal(third.batches.length, 0)
    assert.deepEqual(third.skipped, ['p.md'])
    store.close()
  }))

test('strict mode stops paid calls at the first fatal batch and discards the complete stage', () =>
  withDir(async dir => {
    for (const path of ['a.md', 'b.md', 'c.md']) writeFileSync(join(dir, path), path)
    const store = open()
    let calls = 0
    const report = await run({
      db: ':memory:', store, patterns: ['*.md'], cwd: dir,
      mode: 'stdout', batchSize: 1,
      agent: async () => {
        calls += 1
        return calls === 1 ? 'first IS staged' : 'this is not cave'
      }
    })
    assert.equal(calls, 2, 'strict mode makes no paid call after the first fatal batch')
    assert.equal(report.applied, false)
    assert.equal(report.added, 0)
    assert.deepEqual(report.sources.map(source => source.status), ['accepted', 'rejected', 'not-run'])
    assert.equal(store.currentBeliefs().length, 0, 'earlier staged claims and every digest roll back together')
    store.close()
  }))

test('strict source-selection failures happen before paid calls and preserve the target', () =>
  withDir(async dir => {
    const store = open()
    store.ingest('existing IS retained')
    let calls = 0
    await assert.rejects(run({
      db: ':memory:', store, patterns: [], files: ['missing.md'], cwd: dir,
      mode: 'stdout',
      agent: async () => {
        calls += 1
        return 'unexpected IS call'
      }
    }), /missing\.md/)
    assert.equal(calls, 0)
    assert.deepEqual(store.currentBeliefs().map(row => row.subject), ['existing'])
    store.close()
  }))

test('strict staging preserves explicit provenance and commits the extraction', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'doc.md'), 'doc')
    const store = open()
    try {
      const [id] = store.ingest('api IS trusted @src:manual', { source: 'cli', provenance: { domains: ['team/platform'] } }).ids
      const before = store.provenanceOf(store.currentBeliefs()[0]!)
      const options = {
        db: ':memory:', store, patterns: ['doc.md'], cwd: dir, mode: 'stdout' as const,
        agent: async (_prompt: string, _files: readonly string[], context: { db: string }) => {
          const stage = open(context.db)
          try { assert.deepEqual(stage.provenanceOf(stage.currentBeliefs()[0]!), before) }
          finally { stage.close() }
          return 'request IS reviewed'
        }
      }
      const report = await run(options)
      assert.equal(report.applied, true)
      assert.ok(store.currentBeliefs().some(row => row.subject === 'request'))
      assert.deepEqual(store.provenanceOf(store.currentBeliefs().find(row => row.id === id)!), before)
      assert.equal((await run(options)).skipped.length, 1)
    } finally { store.close() }
  }))

test('strict staging fails when an agent changes an existing identity', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'doc.md'), 'doc')
    const store = open()
    try {
      store.ingest('api IS trusted')
      const before = store.exportText({ tx: true })
      await assert.rejects(run({
        db: ':memory:', store, patterns: ['doc.md'], cwd: dir, mode: 'mcp',
        agent: async (_prompt, _files, context) => {
          const stage = open(context.db)
          try {
            stage.db.exec("UPDATE cave_claim SET object = 'compromised' WHERE subject = 'api'")
            stage.ingest('request IS reviewed')
          } finally { stage.close() }
          return ''
        }
      }), /could not commit.*different content/)
      assert.equal(store.exportText({ tx: true }), before)
    } finally { store.close() }
  }))

test('strict MCP mode discards writes made before an agent failure', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'doc.md'), 'doc')
    const db = join(dir, 'knowledge.db')
    const store = open(db)
    const report = await run({
      db, store, patterns: ['doc.md'], cwd: dir, mode: 'mcp',
      agent: async (_prompt, _files, context) => {
        const staged = open(context.db)
        staged.ingest('partial IS staged')
        staged.close()
        throw new Error('agent failed after writing')
      }
    })
    assert.equal(report.applied, false)
    assert.equal(report.added, 0)
    assert.equal(report.batches[0]!.added, 1, 'the manifest exposes discarded staged work')
    assert.equal(store.currentBeliefs().length, 0)
    store.close()
  }))

test('lenient mode continues every batch and manifests accepted, rejected, and retryable sources', () =>
  withDir(async dir => {
    for (const path of ['a.md', 'b.md', 'c.md']) writeFileSync(join(dir, path), path)
    const store = open()
    let calls = 0
    const options = {
      db: ':memory:', store, patterns: ['*.md'], cwd: dir,
      mode: 'stdout' as const, policy: 'lenient' as const, batchSize: 1
    }
    const report = await run({
      ...options,
      agent: async () => {
        calls += 1
        if (calls === 2) return 'second IS partial\nthis is not cave'
        return `source/${calls} IS accepted`
      }
    })
    assert.equal(calls, 3, 'lenient mode attempts every paid batch')
    assert.equal(report.applied, true)
    assert.equal(report.added, 3, 'valid lines from accepted and rejected batches are committed')
    assert.equal(report.failed, 1)
    assert.deepEqual(report.sources.map(source => source.status), ['accepted', 'rejected', 'accepted'])

    const retried: string[][] = []
    await run({
      ...options,
      agent: async (_prompt, files) => {
        retried.push([...files])
        return 'second IS complete'
      }
    })
    assert.deepEqual(retried, [['b.md']], 'only the rejected source lacks a digest and retries')
    store.close()
  }))

test('stdout ingestion accepts CRLF fences and records accepted sources once', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'source.md'), 'service material')
    for (const policy of ['strict', 'lenient'] as const) {
      const store = open()
      let calls = 0
      try {
        const options = {
          db: ':memory:', store, cwd: dir, patterns: ['source.md'],
          mode: 'stdout' as const, policy, embed: true,
          agent: async () => {
            calls++
            return '```json\r\n{"example": true}\r\n```\r\nExtracted claims:\r\n```cave\r\napi IS service\r\n```\r\nDone.'
          }
        }
        const report = await run(options)
        assert.equal(report.applied, true)
        assert.equal(report.failed, 0)
        assert.equal(report.added, 1)
        assert.equal(report.sources[0]?.status, 'accepted')
        assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'service'))
        const repeated = await run(options)
        assert.equal(repeated.sources[0]?.status, 'skipped')
        assert.equal(repeated.added, 0)
        assert.equal(calls, 1)
      } finally { store.close() }
    }
  }))

for (const policy of ['strict', 'lenient'] as const) test(`ingestion digests retain claim history across source revisions and disappearance (${policy})`, () =>
  withDir(async dir => {
    const path = join(dir, 'service.md')
    const store = open()
    const options = { db: ':memory:', store, cwd: dir, patterns: ['*.md'], embed: true, mode: 'stdout' as const, policy }
    let calls = 0
    try {
      writeFileSync(path, 'Uses redis. Timeout 1000ms.')
      await run({ ...options, agent: async () => { calls++; return 'service USES redis\nservice HAS timeout: 1000ms' } })
      writeFileSync(path, 'Timeout 2000ms.')
      const revised = await run({ ...options, agent: async () => { calls++; return 'service HAS timeout: 2000ms' } })
      assert.equal(revised.applied, true)
      assert.equal(revised.failed, 0)
      const current = store.currentBeliefs().filter(row => row.subject === 'service')
      assert.equal(current.filter(row => row.verb === 'USES' && row.object === 'redis' && row.conf > 0).length, 1)
      assert.deepEqual(current.filter(row => row.attribute === 'timeout').map(row => row.value_num), [2000])
      assert.equal(Files.isIngested(store, 'service.md', Files.digestOf('Timeout 2000ms.')), true)
      const beforeRemoval = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      rmSync(path)
      const absent = await run({ ...options, agent: async () => { throw new Error('absent source must not call agent') } })
      assert.equal(absent.matched, 0)
      assert.deepEqual(absent.sources, [])
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), beforeRemoval)
      writeFileSync(path, 'Timeout 2000ms.')
      const restored = await run({ ...options, agent: async () => { throw new Error('restored identical source must be skipped') } })
      assert.deepEqual(restored.skipped, ['service.md'])
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), beforeRemoval)
      writeFileSync(path, 'No extractable claims.')
      const empty = await run({ ...options, agent: async () => { calls++; return '' } })
      assert.equal(empty.failed, 0)
      assert.equal(empty.added, 0)
      assert.equal(empty.sources[0]!.status, 'accepted')
      assert.equal(Files.isIngested(store, 'service.md', Files.digestOf('No extractable claims.')), true)
      assert.deepEqual(store.currentBeliefs().filter(row => row.subject === 'service'), current)
      assert.equal(calls, 3)
    } finally { store.close() }
  }))
