import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { open } from '@cavelang/store'
import { runIngest } from '../src/main.ts'

class Capture extends Writable {
  value = ''

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.value += String(chunk)
    done()
  }
}

const invoke = async (argv: string[]): Promise<{ code: number, out: string, err: string }> => {
  const stdout = new Capture()
  const stderr = new Capture()
  const code = await runIngest(argv, { stdout, stderr })
  return { code, out: stdout.value, err: stderr.value }
}

test('CLI strict and lenient modes expose atomic exit codes and complete JSON manifests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-main-'))
  try {
    const source = join(dir, 'source.md')
    const agent = join(dir, 'agent.mjs')
    writeFileSync(source, 'source material\n')
    writeFileSync(agent, "process.stdout.write('good USES claim\\nthis is not cave\\n')\n")
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(agent)}`

    const strictDb = join(dir, 'strict.db')
    const strict = await invoke([source, '--db', strictDb, '--stdout', '--agent', command, '--json'])
    assert.equal(strict.code, 1)
    assert.equal(strict.err, '')
    const strictReport = JSON.parse(strict.out)
    assert.equal(strictReport.policy, 'strict')
    assert.equal(strictReport.applied, false)
    assert.equal(strictReport.added, 0)
    assert.deepEqual(strictReport.sources.map((entry: { status: string }) => entry.status), ['rejected'])
    const strictStore = open(strictDb)
    assert.equal(strictStore.currentBeliefs().length, 0)
    strictStore.close()

    const lenientDb = join(dir, 'lenient.db')
    const lenient = await invoke([
      source, '--db', lenientDb, '--stdout', '--agent', command, '--lenient', '--json'
    ])
    assert.equal(lenient.code, 1, 'partial success still returns a failing exit code')
    const lenientReport = JSON.parse(lenient.out)
    assert.equal(lenientReport.policy, 'lenient')
    assert.equal(lenientReport.applied, true)
    assert.equal(lenientReport.added, 1)
    assert.deepEqual(lenientReport.sources.map((entry: { status: string }) => entry.status), ['rejected'])
    const lenientStore = open(lenientDb)
    assert.equal(lenientStore.currentBeliefs().filter(row => row.verb === 'USES').length, 1)
    assert.equal(lenientStore.currentBeliefs().filter(row => row.attribute === 'ingest-digest').length, 0,
      'rejected sources remain retryable')
    lenientStore.close()

    const help = await invoke(['--help'])
    assert.equal(help.code, 0)
    assert.match(help.out, /--lenient\s+commit accepted batches and continue after failures/)
    assert.match(help.out, /--json\s+print the complete machine-readable result manifest/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
