import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cave/store'
import { run, writeMcpConfig } from '@cave/ingest'

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
    assert.equal(store.currentBeliefs().filter(row => row.verb === 'USES').length, 2)

    const again = await run(options)
    assert.equal(again.batches.length, 0, 'unchanged files are skipped')
    assert.deepEqual(again.skipped.length, 2)
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
    const agent =
      'grep -q "Files to ingest" - && grep -q "Files to ingest" {prompt-file} && test -n "{db}" && echo "shell/agent USES stdin"'
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
    const path = writeMcpConfig(join(dir, 'k.db'), dir)
    const config = JSON.parse(String(await import('node:fs').then(fs => fs.readFileSync(path, 'utf8'))))
    const cave = config.mcpServers.cave
    assert.equal(cave.command, process.execPath)
    assert.match(cave.args.join(' '), /bin\.ts --db .*k\.db/)
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
