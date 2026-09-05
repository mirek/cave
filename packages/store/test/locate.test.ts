import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LocateError, Schema, isStoreFile, kindOf, open, openAt, openText } from '@cavelang/store'

const withDir = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-locate-'))
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

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
        assert.match(error.message, /legacy\.db: schema version 0 needs migration to 1 — back up the store, then open it with a writing command such as cave add/)
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
