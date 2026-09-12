import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { exportCommand, generateCommand, reportCommand } from '@cavelang/cli'
import { open } from '@cavelang/store'

for (const command of [exportCommand, generateCommand, reportCommand]) test(`${command.name} preserves an existing destination after a partial write failure`, t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'cave-export-write-'))
  const db = join(dir, 'source.db'), output = join(dir, 'knowledge.cave')
  const store = open(db)
  store.ingest('api IS service\nservice EXPECTS owner #cardinality:one')
  store.close()
  const template = join(dir, 'template.md')
  fs.writeFileSync(template, '# Services\n\n`cave-q: api IS ?kind`\n')
  fs.writeFileSync(output, 'previous export\n')
  const before = fs.readdirSync(dir).sort()
  const write = fs.writeFileSync
  try {
    t.mock.method(fs, 'writeFileSync', (...[path, data, options]: Parameters<typeof fs.writeFileSync>) => {
      write(path, String(data).slice(0, 3), options)
      throw new Error('injected partial write failure')
    })
    syncBuiltinESMExports()
    const result = command([...(command === reportCommand ? [template] : []), '--db', db, '--out', output])
    assert.equal(result.code, 1)
    assert.match(result.err, /injected partial write failure/)
    assert.equal(fs.readFileSync(output, 'utf8'), 'previous export\n')
    assert.deepEqual(fs.readdirSync(dir).sort(), before)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('export payload failure preserves destinations and database bytes and recovers after repair', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'cave-export-payload-'))
  const db = join(dir, 'source.db'), existing = join(dir, 'previous.cave'), missing = join(dir, 'new.cave')
  const store = open(db)
  let id: string
  try {
    store.ingest('visible IS retained #sensitivity:public')
    id = store.ingest('secret IS retained #sensitivity:restricted').ids[0]!
    store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run('42', id)
  } finally { store.close() }
  try {
    fs.writeFileSync(existing, 'previous complete export\n')
    const before = fs.readFileSync(db), entries = fs.readdirSync(dir).sort()
    for (const flags of [[], ['--current'], ['--tx'], ['--current', '--tx']]) {
      for (const output of [undefined, existing, missing]) {
        const failed = exportCommand(['--db', db, '--max-sensitivity', 'restricted', ...flags,
          ...(output === undefined ? [] : ['--out', output])])
        assert.equal(failed.code, 1)
        assert.equal(failed.out, '')
        assert.ok(failed.err.includes(id), failed.err)
        assert.match(failed.err, /payload/)
        assert.equal(fs.readFileSync(existing, 'utf8'), 'previous complete export\n')
        assert.equal(fs.existsSync(missing), false)
        assert.deepEqual(fs.readFileSync(db), before)
        assert.deepEqual(fs.readdirSync(dir).sort(), entries)
      }
    }
    const scoped = exportCommand(['--db', db, '--max-sensitivity', 'public'])
    assert.equal(scoped.code, 0, scoped.err)
    assert.match(scoped.out, /visible IS retained/)
    assert.doesNotMatch(scoped.out, /secret/)
    const repair = open(db)
    try { repair.db.prepare('UPDATE cave_claim SET value_text = NULL WHERE id = ?').run(id) }
    finally { repair.close() }
    const args = ['--db', db, '--max-sensitivity', 'restricted', '--tx']
    const recovered = exportCommand(args)
    assert.equal(recovered.code, 0, recovered.err)
    assert.match(recovered.out, /secret IS retained/)
    for (const output of [existing, missing]) {
      const written = exportCommand([...args, '--out', output])
      assert.equal(written.code, 0, written.err)
      assert.equal(fs.readFileSync(output, 'utf8'), recovered.out)
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('report citation failure preserves output files and recovers after evidence correction', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'cave-report-evidence-'))
  const db = join(dir, 'source.db'), template = join(dir, 'template.md')
  const existing = join(dir, 'report.md'), missing = join(dir, 'new-report.md')
  const store = open(db)
  let id: string
  try {
    store.ingest('healthy IS service')
    id = store.ingest('broken IS service').ids[0]!
    store.db.prepare('INSERT INTO cave_context (claim_id, context) VALUES (?, ?)').run(id, 'invalid\ncontext')
  } finally { store.close() }
  try {
    fs.writeFileSync(template, 'First: `cave-q: healthy IS ?kind`\nSecond: `cave-q: broken IS ?kind`\n')
    fs.writeFileSync(existing, 'previous complete report\n')
    const before = fs.readFileSync(db)
    const entries = fs.readdirSync(dir).sort()
    const args = [template, '--db', db, '--max-sensitivity', 'restricted']
    for (const output of [undefined, existing, missing]) {
      const failed = reportCommand([...args, ...(output === undefined ? [] : ['--out', output])])
      assert.equal(failed.code, 1)
      assert.equal(failed.out, '')
      assert.ok(failed.err.includes(`report citation failed for claim ${id}`), failed.err)
      assert.match(failed.err, /newline/)
      assert.equal(fs.readFileSync(existing, 'utf8'), 'previous complete report\n')
      assert.equal(fs.existsSync(missing), false)
      assert.deepEqual(fs.readFileSync(db), before)
      assert.deepEqual(fs.readdirSync(dir).sort(), entries)
    }
    const repair = open(db)
    try {
      repair.db.prepare('DELETE FROM cave_context WHERE claim_id = ? AND context = ?').run(id, 'invalid\ncontext')
    } finally { repair.close() }
    const recovered = reportCommand(args)
    assert.equal(recovered.code, 0, recovered.err)
    assert.match(recovered.out, /First: service\[\^c1\]/)
    assert.match(recovered.out, /Second: service\[\^c2\]/)
    for (const output of [existing, missing]) {
      const written = reportCommand([...args, '--out', output])
      assert.equal(written.code, 0, written.err)
      assert.equal(fs.readFileSync(output, 'utf8'), recovered.out)
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('export follows symlinks, preserves permissions, and leaves hard-link aliases unchanged', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'cave-export-links-'))
  try {
    const db = join(dir, 'source.db'), output = join(dir, 'knowledge.cave')
    const store = open(db)
    store.ingest('api IS service')
    store.close()
    fs.writeFileSync(output, 'previous export\n', { mode: 0o640 })
    fs.chmodSync(output, 0o640)
    const alias = join(dir, 'old.cave'), link = join(dir, 'link.cave')
    fs.linkSync(output, alias)
    fs.symlinkSync(output, link)
    assert.equal(exportCommand(['--db', db, '--out', link]).code, 0)
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true)
    assert.equal(fs.readFileSync(output, 'utf8'), 'api IS service\n')
    assert.equal(fs.statSync(output).mode & 0o777, 0o640)
    assert.equal(fs.readFileSync(alias, 'utf8'), 'previous export\n')
    const missing = join(dir, 'missing.cave'), dangling = join(dir, 'dangling.cave')
    fs.symlinkSync(missing, dangling)
    assert.equal(exportCommand(['--db', db, '--out', dangling]).code, 1)
    assert.equal(fs.lstatSync(dangling).isSymbolicLink(), true)
    assert.equal(fs.existsSync(missing), false)
    assert.equal(exportCommand(['--db', db, '--out', dir]).code, 1)
    assert.equal(fs.readdirSync(dir).some(name => name.startsWith('.cave-export-')), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('file output commands leave no partial new file and recover after publication failures', t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'cave-new-output-failure-'))
  const db = join(dir, 'source.db'), output = join(dir, 'new-output.txt')
  const template = join(dir, 'template.md')
  const store = open(db)
  store.ingest('api IS service\nservice EXPECTS owner #cardinality:one')
  store.close()
  fs.writeFileSync(template, '# Services\n\n`cave-q: api IS ?kind`\n')
  const before = fs.readdirSync(dir).sort()
  const write = fs.writeFileSync
  try {
    for (const command of [exportCommand, generateCommand, reportCommand]) {
      const args = [...(command === reportCommand ? [template] : []), '--db', db, '--out', output]
      for (const operation of ['writeFileSync', 'fsyncSync', 'renameSync'] as const) {
        try {
          if (operation === 'writeFileSync') {
            t.mock.method(fs, operation, (...[path, data, options]: Parameters<typeof fs.writeFileSync>) => {
              write(path, String(data).slice(0, 3), options)
              throw new Error('injected new-output failure')
            })
          } else {
            t.mock.method(fs, operation, () => { throw new Error('injected new-output failure') })
          }
          syncBuiltinESMExports()
          const failed = command(args)
          assert.equal(failed.code, 1, `${command.name}: ${operation}`)
          assert.match(failed.err, /injected new-output failure/)
          assert.equal(fs.existsSync(output), false)
          assert.deepEqual(fs.readdirSync(dir).sort(), before)
        } finally {
          t.mock.restoreAll()
          syncBuiltinESMExports()
        }
        const expected = command(args.slice(0, -2))
        const retried = command(args)
        assert.equal(retried.code, 0, retried.err)
        assert.equal(fs.readFileSync(output, 'utf8'), expected.out)
        fs.rmSync(output)
        assert.deepEqual(fs.readdirSync(dir).sort(), before)
      }
    }
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

for (const operation of ['fsyncSync', 'renameSync'] as const) {
  test(`export preserves its destination when ${operation} fails`, t => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'cave-export-publish-'))
    const db = join(dir, 'source.db'), output = join(dir, 'knowledge.cave')
    const store = open(db)
    store.ingest('api IS service')
    store.close()
    fs.writeFileSync(output, 'previous export\n')
    try {
      t.mock.method(fs, operation, () => { throw new Error(`injected ${operation} failure`) })
      const result = exportCommand(['--db', db, '--out', output])
      assert.equal(result.code, 1)
      assert.match(result.err, /injected/)
      assert.equal(fs.readFileSync(output, 'utf8'), 'previous export\n')
      assert.equal(fs.readdirSync(dir).some(name => name.startsWith('.cave-export-')), false)
    } finally { t.mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }) }
  })
}

test('report publishes complete diagnostic Markdown despite template problems', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'cave-report-diagnostic-'))
  try {
    const db = join(dir, 'source.db'), template = join(dir, 'template.md'), output = join(dir, 'report.md')
    open(db).close()
    fs.writeFileSync(template, '# Report\n\nMissing: `cave-q: absent IS ?kind`.\n')
    fs.writeFileSync(output, 'previous report\n')
    const expected = reportCommand([template, '--db', db])
    assert.equal(expected.code, 1)
    assert.notEqual(expected.err, '')
    const written = reportCommand([template, '--db', db, '--out', output])
    assert.equal(written.code, 1)
    assert.equal(written.err, expected.err)
    assert.equal(fs.readFileSync(output, 'utf8'), expected.out)
    assert.equal(fs.readdirSync(dir).some(name => name.startsWith('.cave-export-')), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})


test('report rejects invalid temporal options before publishing or reading inputs', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'cave-report-time-'))
  try {
    const db = join(dir, 'source.db'), template = join(dir, 'template.md'), output = join(dir, 'report.md')
    open(db).close()
    for (const content of ['# Static report\n', 'Value: `cave-q: api HAS status: ?v`\n']) {
      fs.writeFileSync(template, content)
      for (const option of ['--at', '--as-of']) {
        fs.writeFileSync(output, 'previous report\n')
        const result = reportCommand([template, '--db', db, '--out', output, option, 'not-a-time'])
        assert.equal(result.code, 1)
        assert.equal(result.out, '')
        assert.match(result.err, new RegExp(option))
        assert.equal(fs.readFileSync(output, 'utf8'), 'previous report\n')
        const missing = join(dir, 'missing')
        const rejected = reportCommand([missing, '--db', missing, option, 'not-a-time'])
        assert.equal(rejected.code, 1, 'invalid options fail before accessing missing inputs')
        assert.match(rejected.err, new RegExp(option))
      }
    }
    fs.writeFileSync(template, '# Static report\n')
    for (const [option, value] of [
      ['--at', '2026'], ['--at', '2026-01-01T12:00:00Z'],
      ['--as-of', '2026-01'], ['--as-of', '01900000-0000-7000-8000-000000000000']
    ]) {
      const accepted = reportCommand([template, '--db', db, option!, value!])
      assert.equal(accepted.code, 0, accepted.err)
      assert.equal(accepted.out, '# Static report\n')
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
