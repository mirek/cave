import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { writeOutput } from '../src/atomic-output.ts'
import { backup, open, verifyBackup } from '@cavelang/store'
import { backupCommand, restoreCommand, exportCommand, generateCommand, reportCommand } from '@cavelang/cli'

for (const command of [backupCommand, restoreCommand]) {
  test(`${command.name} displays the cause of a post-publication failure`, t => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'cave-snapshot-diagnostic-'))
    const db = join(directory, 'source.db'), snapshot = join(directory, 'snapshot.db')
    const target = join(directory, 'target.db')
    const store = open(db)
    try {
      store.ingest('api IS service')
      backup(store, snapshot)
      store.close()
      const remove = fs.rmSync
      let removals = 0
      t.mock.method(fs, 'rmSync', (...args: Parameters<typeof fs.rmSync>) => {
        if (String(args[0]).endsWith('.tmp') && ++removals === 1) {
          throw new Error('snapshot temporary unlink denied')
        }
        return remove(...args)
      })
      syncBuiltinESMExports()
      const result = command === backupCommand ? command(['--db', db, '--out', target]) :
        command([snapshot, '--db', target])
      assert.equal(result.code, 1)
      assert.equal(result.out, '')
      assert.ok(result.err.includes(`snapshot published to ${target}`))
      assert.match(result.err, /snapshot temporary unlink denied/)
      assert.equal(removals, 2)
      t.mock.restoreAll()
      syncBuiltinESMExports()
      assert.equal(verifyBackup(target).rows, 1)
      assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.tmp')), false)
    } finally {
      t.mock.restoreAll()
      syncBuiltinESMExports()
      store.close()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}

for (const phases of [
  ['write'], ['close'], ['remove'], ['write', 'close'],
  ['write', 'remove'], ['close', 'remove'], ['write', 'close', 'remove'], ['rename', 'remove'],
] as const) {
  test(`atomic output retains failures from ${phases.join(', ')}`, t => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'cave-output-cleanup-'))
    const destination = join(directory, 'report.md')
    fs.writeFileSync(destination, 'previous report\n')
    const active = new Set<string>(phases)
    const failures = new Map(phases.map(phase => [phase, new Error(`${phase} failed`)]))
    const write = fs.writeFileSync, close = fs.closeSync, remove = fs.rmSync
    let closes = 0, removals = 0
    try {
      if (active.has('write')) t.mock.method(fs, 'writeFileSync', (...[path, , options]: Parameters<typeof fs.writeFileSync>) => {
        write(path, 'partial', options)
        throw failures.get('write')
      })
      t.mock.method(fs, 'closeSync', (fd: number) => {
        closes++
        close(fd)
        if (active.has('close')) throw failures.get('close')
      })
      if (active.has('rename')) t.mock.method(fs, 'renameSync', () => { throw failures.get('rename') })
      t.mock.method(fs, 'rmSync', (...args: Parameters<typeof fs.rmSync>) => {
        removals++
        remove(...args)
        if (active.has('remove')) throw failures.get('remove')
      })
      assert.throws(() => writeOutput(destination, 'complete report\n'), error => {
        const expected = [...failures.values()]
        if (phases.length === 1 && phases[0] === 'remove') {
          assert.ok(error instanceof Error)
          assert.equal(error.cause, expected[0])
          assert.ok(error.message.includes(`output published to ${destination}`))
          assert.match(error.message, /temporary directory cleanup failed: .*\.cave-export-/)
          assert.match(error.message, /remove failed/)
        } else if (expected.length === 1) assert.equal(error, expected[0])
        else {
          assert.ok(error instanceof AggregateError)
          assert.deepEqual(error.errors, expected)
          assert.equal(error.cause, expected[0])
          for (const failure of expected) assert.ok(error.message.includes(failure.message))
        }
        return true
      })
      assert.equal(closes, 1)
      assert.equal(removals, 1)
      assert.equal(fs.readFileSync(destination, 'utf8'), phases.length === 1 && phases[0] === 'remove' ? 'complete report\n' : 'previous report\n')
      assert.deepEqual(fs.readdirSync(directory), ['report.md'])
      t.mock.restoreAll()
      writeOutput(destination, 'recovered report\n')
      assert.equal(fs.readFileSync(destination, 'utf8'), 'recovered report\n')
    } finally {
      t.mock.restoreAll()
      remove(directory, { recursive: true, force: true })
    }
  })
}

for (const command of [exportCommand, generateCommand, reportCommand]) {
  test(`${command.name} reports temporary cleanup failure after complete publication`, t => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'cave-published-cleanup-'))
    const db = join(directory, 'source.db'), destination = join(directory, 'output.txt'), template = join(directory, 'template.md')
    const store = open(db)
    store.ingest('api IS service')
    store.close()
    fs.writeFileSync(template, '# Report\n')
    const args = [...(command === reportCommand ? [template] : []), '--db', db]
    const expected = command(args)
    assert.equal(expected.code, 0, expected.err)
    const remove = fs.rmSync
    try {
      t.mock.method(fs, 'rmSync', () => {
        throw new Error('temporary cleanup failed')
      })
      const result = command([...args, '--out', destination])
      assert.equal(result.code, 1)
      assert.equal(result.out, '')
      assert.match(result.err, /temporary cleanup failed/)
      assert.ok(result.err.includes(`output published to ${destination}`))
      assert.match(result.err, /temporary directory cleanup failed: .*\.cave-export-/)
      const remaining = fs.readdirSync(directory).filter(name => name.startsWith('.cave-export-'))
      assert.equal(remaining.length, 1)
      assert.ok(result.err.includes(join(directory, remaining[0]!)))
      assert.deepEqual(fs.readdirSync(join(directory, remaining[0]!)), [])
      assert.equal(fs.readFileSync(destination, 'utf8'), expected.out)
      t.mock.restoreAll()
      assert.equal(command([...args, '--out', destination]).code, 0)
    } finally {
      t.mock.restoreAll()
      remove(directory, { recursive: true, force: true })
    }
  })
}
