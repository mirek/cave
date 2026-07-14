import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { run, runShellAgent, writeMcpConfig } from '@cavelang/ingest'

const withDir = (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-run-'))
  return body(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

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

test('mcp mode reports the database delta made by an external agent', () =>
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
      agent: async () => {
        const external = open(db)
        external.ingest('doc/topic CONTAINS important-fact')
        external.close()
        return 'done: 1'
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

test('problems in agent output are reported, valid lines still land', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'm.md'), 'm')
    const store = open()
    const report = await run({
      db: ':memory:', store, patterns: ['*.md'], cwd: dir,
      mode: 'stdout',
      agent: async () => 'good USES claim\nthis is not cave\n'
    })
    assert.equal(report.added, 1)
    assert.equal(report.batches[0]!.problems.length, 1)
    store.close()
  }))

test('a batch with parse problems does not record digests — sources are retried (BUGS.md partial-ingest-digests)', () =>
  withDir(async dir => {
    writeFileSync(join(dir, 'p.md'), 'p')
    const store = open()
    const options = {
      db: ':memory:', store, patterns: ['*.md'], cwd: dir,
      mode: 'stdout' as const
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
