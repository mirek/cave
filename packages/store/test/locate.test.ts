import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Registry, standardRegistry } from '@cavelang/canonical'
import { LocateError, Schema, isStoreFile, kindOf, open, openAt, openText } from '@cavelang/store'

const withDir = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-locate-'))
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('text-store replay rejects invalid UTF-8 before assembly and preserves source bytes', () => {
  withDir(dir => {
    const file = join(dir, 'notes.cave')
    const bytes = Buffer.concat([Buffer.from('api HAS label: "bad'), Buffer.from([0xff]), Buffer.from('text"')])
    writeFileSync(file, bytes)
    let assembled = false
    for (const intent of ['read', 'scratch'] as const) {
      assert.throws(() => openAt(file, { intent, assemble: () => { assembled = true } }),
        error => error instanceof LocateError && /invalid UTF-8/.test(error.message))
    }
    assert.equal(assembled, false)
    assert.deepEqual(readFileSync(file), bytes)
    writeFileSync(file, 'api HAS label: "�café 😀"')
    const recovered = openText(file)
    try { assert.match(recovered.exportText(), /�café 😀/) } finally { recovered.close() }
  })
})

test('kindOf classifies a path by content, not extension', () => {
  withDir(dir => {
    assert.equal(kindOf(':memory:'), 'memory')
    assert.equal(kindOf(join(dir, 'nope.db')), 'missing')

    const sqliteNamedCave = join(dir, 'k.cave')
    open(sqliteNamedCave).close()
    assert.equal(isStoreFile(sqliteNamedCave), true)
    assert.equal(kindOf(sqliteNamedCave), 'sqlite')

    const textNamedDb = join(dir, 'notes.db')
    writeFileSync(textNamedDb, 'api IS service\n')
    assert.equal(isStoreFile(textNamedDb), false)
    assert.equal(kindOf(textNamedDb), 'text')
  })
})

test('a CAVE text file opens as an in-memory store with import semantics', () => {
  withDir(dir => {
    const file = join(dir, 'repos.cave')
    writeFileSync(file, 'cave IS repo\ncave HAS stars: 12\ncave USES sqlite @src:readme\n')
    const store = openAt(file, { intent: 'read' })
    try {
      const subjects = store.currentBeliefs().map(row => `${row.subject} ${row.verb}`)
      assert.deepEqual(subjects.sort(), ['cave HAS', 'cave IS', 'cave USES'])
      const text = store.exportText({})
      assert.match(text, /IS repo/)
      assert.match(text, /@src:readme/, 'authored provenance is kept')
      assert.doesNotMatch(text, /src:cli/, 'replay stamps no actor, exactly like cave import')
    } finally {
      store.close()
    }
    assert.equal(kindOf(file), 'text', 'the text file is untouched')
  })
})

test('a text store refuses a write open with the materialization hint', () => {
  withDir(dir => {
    const file = join(dir, 'repos.cave')
    writeFileSync(file, 'cave IS repo\n')
    assert.throws(() => openAt(file), /repos\.cave is CAVE text, not a database.*cave import --db <store\.db>/)
    assert.throws(() => openAt(file, { intent: 'write' }), /text stores are read-only/)
  })
})

test('a text file that fails to parse fails the load, naming every line', () => {
  withDir(dir => {
    const file = join(dir, 'bad.cave')
    writeFileSync(file, 'a USES b\nthis is not\nc USES\n')
    assert.throws(() => openText(file), error => {
      assert.match(String(error), /cannot load .*bad\.cave as a store/)
      assert.match(String(error), /bad\.cave line 2: /)
      assert.match(String(error), /bad\.cave line 3: /)
      return true
    })
  })
})

test('a read open never creates a database; a write open still does', () => {
  withDir(dir => {
    const missing = join(dir, 'typo.db')
    assert.throws(() => openAt(missing, { intent: 'read' }), /no store at .*typo\.db — create one with `cave add --db .*typo\.db`/)
    assert.equal(existsSync(missing), false)

    const created = openAt(missing, { intent: 'write' })
    created.close()
    assert.equal(kindOf(missing), 'sqlite')

    const reopened = openAt(missing, { intent: 'read' })
    reopened.close()
  })
})

const versionOf = (path: string): number => {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return Schema.versionOf(db)
  } finally {
    db.close()
  }
}

test('read and scratch opens never migrate an older store; a write open does', () => {
  withDir(dir => {
    const path = join(dir, 'legacy.db')
    const store = open(path)
    store.ingest('a IS b')
    store.db.exec('PRAGMA user_version = 0')
    store.close()
    const before = readFileSync(path)
    for (const intent of ['read', 'scratch'] as const) {
      assert.throws(() => openAt(path, { intent }), error => {
        assert.ok(error instanceof LocateError, `${intent}: a usage failure, not a crash`)
        assert.match(error.message, /legacy\.db: schema version 0 needs migration to 2 — close every user and copy the file as a rollback point, then open it with a writing command such as cave add/)
        return true
      })
      assert.equal(versionOf(path), 0, `${intent} left the version alone`)
    }
    assert.deepEqual(readFileSync(path), before, 'not a byte changed')
    const migrated = openAt(path, { intent: 'write' })
    migrated.close()
    assert.equal(versionOf(path), Schema.currentVersion, 'a writing open migrates')
  })
})

test('a read open is read-only and serves a write-protected store', () => {
  withDir(dir => {
    const path = join(dir, 'k.db')
    const writer = open(path)
    writer.ingest('a IS b')
    writer.close()
    chmodSync(path, 0o444)
    try {
      const reader = openAt(path, { intent: 'read' })
      try {
        assert.equal(reader.currentBeliefs().length, 1)
        assert.throws(() => reader.ingest('c IS d'), /readonly|read-only/i, 'the connection itself refuses writes')
      } finally {
        reader.close()
      }
      const scratch = openAt(path, { intent: 'scratch' })
      scratch.close()
    } finally {
      chmodSync(path, 0o644)
    }
  })
})

test('a read open serves a WAL-mode store without changing the database', () => {
  withDir(dir => {
    const path = join(dir, 'wal.db')
    const writer = open(path)
    writer.db.exec('PRAGMA journal_mode = WAL')
    writer.ingest('a IS b')
    writer.close()
    for (const sidecar of ['-wal', '-shm']) {
      rmSync(`${path}${sidecar}`, { force: true })
    }
    const before = readFileSync(path)
    const reader = openAt(path, { intent: 'read' })
    try {
      assert.equal(reader.currentBeliefs().length, 1)
      assert.equal((reader.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal')
    } finally {
      reader.close()
    }
    assert.deepEqual(readFileSync(path), before, 'the database file is untouched')
    // The WAL sidecars are the documented exception (spec §13.7): SQLite
    // recreates the (empty) log and the index a read-only connection
    // coordinates through; nothing else appears.
    assert.deepEqual(
      readdirSync(dir).filter(name => name.startsWith('wal.db') && !['wal.db', 'wal.db-wal', 'wal.db-shm'].includes(name)),
      [], 'no other sidecar')
    if (existsSync(`${path}-wal`)) {
      assert.equal(readFileSync(`${path}-wal`).length, 0, 'the read wrote nothing to the log')
    }
  })
})

test('path opens reject unknown intents before opening or assembling any store', () => {
  withDir(dir => {
    const database = join(dir, 'knowledge.db')
    const source = open(database)
    source.ingest('retained IS evidence')
    source.close()
    const text = join(dir, 'notes.cave')
    writeFileSync(text, 'retained IS evidence\n')
    const missing = join(dir, 'missing.db')
    const databaseBefore = readFileSync(database), textBefore = readFileSync(text)
    let assemblies = 0, coercions = 0
    for (const intent of ['', 'READ', 'read-only', null, 0, true, Symbol('intent'),
      { [Symbol.toPrimitive]() { coercions++; return 'read' } }]) {
      for (const path of [database, text, ':memory:', missing]) {
        assert.throws(() => {
          const opened = openAt(path, { intent: intent as never, assemble: () => { assemblies++ } })
          opened.close()
        }, error => error instanceof TypeError && /intent.*read.*scratch.*write/.test(error.message))
      }
    }
    assert.equal(assemblies, 0)
    assert.equal(coercions, 0)
    assert.equal(existsSync(missing), false)
    assert.deepEqual(readFileSync(database), databaseBefore)
    assert.deepEqual(readFileSync(text), textBefore)
    const recovered = openAt(database, { intent: 'read' })
    try { assert.equal(recovered.currentBeliefs().length, 1) }
    finally { recovered.close() }
    openAt(missing).close()
    assert.equal(existsSync(missing), true, 'omitted intent retains the documented write default')
  })
})

test('path opens preserve inherited and non-enumerable registry and assembly options', () => {
  withDir(dir => {
    const registry = Registry.declareVerb(standardRegistry, 'GOVERNS')
    for (const hidden of [false, true]) for (const kind of ['text', 'sqlite', 'memory', 'missing'] as const) {
      const path = kind === 'memory' ? ':memory:' : join(dir, `${kind}-${hidden}`)
      if (kind === 'text') writeFileSync(path, 'retained IS evidence\n')
      if (kind === 'sqlite') open(path).close()
      let assemblies = 0
      const values = {
        intent: kind === 'missing' ? 'write' as const : 'read' as const,
        registry,
        assemble(store: ReturnType<typeof open>, root: string) {
          assemblies++
          assert.equal(root, path)
          store.ingest('reviewer GOVERNS knowledge', { strict: true })
        }
      }
      const options = hidden ? Object.defineProperties({}, Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, { value, enumerable: false }])
      )) : Object.create(values)
      const store = openAt(path, options)
      try {
        assert.equal(Registry.isDeclared(store.registry(), 'GOVERNS'), true, `${kind}, hidden=${hidden}`)
        assert.equal(assemblies, kind === 'text' ? 1 : 0)
        assert.equal(store.currentBeliefs().length, kind === 'text' ? 2 : 0)
      } finally { store.close() }
      if (kind === 'text') assert.equal(readFileSync(path, 'utf8'), 'retained IS evidence\n')
    }
  })
})

test('a text store hands itself to the assembler with its own path', () => {
  withDir(dir => {
    const file = join(dir, 'notes.cave')
    writeFileSync(file, 'a IS b\n')
    const roots: string[] = []
    const store = openAt(file, {
      intent: 'read',
      assemble: (assembled, root) => {
        roots.push(root)
        assembled.ingest('c IS d')
      }
    })
    try {
      assert.deepEqual(roots, [file])
      assert.equal(store.currentBeliefs().length, 2, 'what the assembler appends is part of the store')
    } finally {
      store.close()
    }
    assert.throws(() => openAt(file, {
      intent: 'read',
      assemble: () => { throw new LocateError('source/x (x.csv): missing') }
    }), /source\/x \(x\.csv\): missing/)
  })
})

test('text assembly retains its failure when store-owned cleanup also throws', () => {
  withDir(dir => {
    const file = join(dir, 'notes.cave')
    writeFileSync(file, 'retained IS evidence\n')
    const before = readFileSync(file)
    for (const direct of [false, true]) for (const opaque of [false, true]) {
      const failure = opaque ? Object.create(null) : new LocateError('source assembly failed')
      const cleanupFailure = opaque ? Object.create(null) : new Error('assembly cleanup failed')
      let closes = 0
      let assembled: ReturnType<typeof open> | undefined
      const assemble = (store: ReturnType<typeof open>) => {
        assembled = store
        store.onClose(() => { closes++; throw cleanupFailure })
        store.ingest('temporary IS assembled')
        throw failure
      }
      assert.throws(() => direct ? openText(file, { assemble }) : openAt(file, { intent: 'read', assemble }), error => {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.cause, failure)
        assert.deepEqual(error.errors, [failure, cleanupFailure])
        assert.match(error.message, opaque ? /unprintable thrown value/ : /source assembly failed.*assembly cleanup failed/)
        return true
      })
      assert.equal(closes, 1)
      assert.throws(() => assembled!.db.prepare('SELECT 1'), /closed|not open/)
      assert.deepEqual(readFileSync(file), before)
      const recovered = openText(file)
      try { assert.equal(recovered.currentBeliefs().length, 1) }
      finally { recovered.close() }
    }
  })
})

test('store-file detection assembles short reads and stops at incomplete-header EOF', async t => {
  const { default: fs } = await import('node:fs')
  const { syncBuiltinESMExports } = await import('node:module')
  withDir(dir => {
    const database = join(dir, 'knowledge.cave')
    const source = open(database)
    source.ingest('retained IS evidence')
    source.close()
    const partial = join(dir, 'partial.db')
    writeFileSync(partial, 'SQLite format 3')
    const before = readFileSync(database)
    const read = fs.readSync, close = fs.closeSync
    let reads = 0, closes = 0
    try {
      t.mock.method(fs, 'readSync', (fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null) => {
        reads++
        return read(fd, buffer, offset, Math.min(length, 3), position)
      })
      t.mock.method(fs, 'closeSync', (fd: number) => { closes++; close(fd) })
      syncBuiltinESMExports()
      assert.equal(isStoreFile(database), true)
      assert.equal(reads, 6)
      assert.equal(closes, 1)
      reads = 0
      assert.equal(isStoreFile(partial), false)
      assert.equal(reads, 6, 'five chunks followed by EOF')
      assert.equal(closes, 2)
      assert.equal(kindOf(database), 'sqlite')
      assert.equal(kindOf(partial), 'text')
      assert.equal(closes, 4)
    } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
    assert.deepEqual(readFileSync(database), before)
    const reopened = openAt(database, { intent: 'read' })
    try { assert.equal(reopened.currentBeliefs().length, 1) }
    finally { reopened.close() }
  })
})

test('store-file detection preserves read and descriptor-close failures', async t => {
  const { default: fs } = await import('node:fs')
  const { syncBuiltinESMExports } = await import('node:module')
  withDir(dir => {
    const file = join(dir, 'knowledge.db')
    const source = open(file)
    source.ingest('retained IS evidence')
    source.close()
    const before = readFileSync(file)
    const failure = new Error('header read failed'), closeFailure = new Error('header close failed')
    const close = fs.closeSync
    let closes = 0
    try {
      t.mock.method(fs, 'readSync', () => { throw failure })
      t.mock.method(fs, 'closeSync', (fd: number) => { close(fd); closes++; throw closeFailure })
      syncBuiltinESMExports()
      for (const inspect of [isStoreFile, kindOf, (path: string) => openAt(path, { intent: 'read' })]) {
        assert.throws(() => inspect(file), error => {
          assert.ok(error instanceof AggregateError)
          assert.equal(error.cause, failure)
          assert.deepEqual(error.errors, [failure, closeFailure])
          assert.ok(error.message.includes(failure.message))
          assert.ok(error.message.includes(closeFailure.message))
          return true
        })
      }
      assert.equal(closes, 3)
    } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
    assert.equal(isStoreFile(file), true)
    assert.equal(kindOf(file), 'sqlite')
    const reopened = openAt(file, { intent: 'read' })
    reopened.close()
    assert.deepEqual(readFileSync(file), before)
  })
})
