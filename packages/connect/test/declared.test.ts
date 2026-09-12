import { test } from 'node:test'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { syncBuiltinESMExports } from 'node:module'
import * as assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { LocateError, open, openAt } from '@cavelang/store'
import { Declared, assemble, declaredNaming } from '@cavelang/connect'

test('declared ownership closure handles cycles, shared descendants and duplicate selections', () => {
  const store = open()
  try {
    store.ingest('source/root HAS path: root.cave\nsource/unrelated HAS path: unrelated.cave')
    store.ingest('source/a HAS path: a.cave\nsource/b HAS path: b.cave', { provenance: { run: 'root/record' } })
    store.ingest('source/root HAS path: root.cave\nsource/leaf HAS path: leaf.cave', { provenance: { run: 'a' } })
    store.ingest('source/leaf HAS path: leaf.cave', { provenance: { run: 'b' } })
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const names of [['root'], ['root', 'root', 'a'], ['a']]) {
      assert.deepEqual(Declared.closure(store, names).map(source => source.name).sort(), ['a', 'b', 'leaf', 'root'])
    }
    assert.deepEqual(Declared.closure(store, ['b']).map(source => source.name).sort(), ['b', 'leaf'])
    assert.deepEqual(Declared.closure(store, Array.from({ length: 10_000 }, (_, i) => `missing${i}`)), [])
    assert.deepEqual(Declared.closure(store, []), [])
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('cancelled declared discovery discards its snapshot and preserves the abort reason', async t => {
  const store = open()
  const controller = new AbortController(), reason = new Error('cancel discovery')
  const snapshots: string[] = []
  try {
    store.ingest('source/a HAS path: https://records.test/a.cave')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const capability = store.adapter.capabilities.backup!
    const write = capability.write.bind(capability)
    t.mock.method(capability, 'write', (db: Parameters<typeof write>[0], destination: string) => {
      snapshots.push(destination)
      return write(db, destination)
    })
    const options = {
      signal: controller.signal,
      fetchImpl: async () => {
        controller.abort(reason)
        return new Response('source/next HAS path: https://records.test/next.cave')
      }
    }
    await assert.rejects(Declared.discovery(store, 'root.db', options), error => error === reason)
    assert.equal(snapshots.length, 1)
    assert.ok(snapshots.every(path => !existsSync(dirname(path))))
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    await assert.rejects(Declared.discovery(store, 'root.db', options), error => error === reason)
    assert.equal(snapshots.length, 1, 'pre-aborted discovery does not allocate a snapshot')
  } finally { store.close() }
})

test('declared discovery retains the initially selected cancellation signal', async () => {
  const store = open()
  const controller = new AbortController(), reason = new Error('original discovery signal')
  try {
    store.ingest('source/a HAS path: https://records.test/a.cave')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    let reads = 0
    await assert.rejects(Declared.discovery(store, 'root.db', {
      get signal() { return ++reads === 1 ? controller.signal : undefined },
      fetchImpl: async () => {
        await Promise.resolve()
        controller.abort(reason)
        return new Response('a IS remote')
      }
    }), error => error === reason)
    assert.equal(reads, 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('declared preparation retains the identity whose content was fetched', async () => {
  const declared = { name: 'original', path: 'https://records.test/original.cave' }
  const expected = { ...declared }
  const ready = await Declared.prepare(declared, '.', async () => {
    await Promise.resolve()
    declared.name = 'replacement'
    declared.path = 'https://records.test/replacement.cave'
    return new Response('a IS remote')
  })
  assert.deepEqual(ready.declared, expected)
  declared.name = 'later'
  assert.deepEqual(ready.declared, expected)
  const store = open()
  try {
    assert.deepEqual(Declared.run(store, ready).failures, [])
    assert.equal(Declared.recordedDeclaration(store, 'original'), Declared.declarationDigest(expected))
    const row = store.currentBeliefs().find(row => row.subject === 'a')!
    assert.ok(store.toClaim(row).contexts.includes('src:original'))
  } finally { store.close() }
})

test('synchronous preparation owns its declaration after returning', () => withDir(dir => {
  writeFileSync(join(dir, 'source.cave'), 'a IS local')
  const declared = { name: 'original', path: 'source.cave' }
  const ready = Declared.prepareSync(declared, dir)
  declared.name = 'replacement'
  declared.path = 'other.cave'
  assert.deepEqual(ready.declared, { name: 'original', path: 'source.cave' })
}))

const withDir = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const people = 'id,name,company\n1,ann,acme\n2,bob,globex\n'
const peopleMap = '?name IS person\n?name WORKS-AT ?company\n'

test('declared sources are current source/<name> claims with a path; retracting the path removes one (spec §23.4)', () => {
  const store = open()
  try {
    store.ingest([
      'source/people HAS path: data/people.csv',
      'source/people HAS map: people.map.cave',
      'source/people HAS key: id',
      'source/people HAS reliability: 80%',
      'source/verbs HAS path: verbs.cave',
      'source/gone HAS path: gone.csv',
      'source/gone HAS path: gone.csv @ 0%',
      'source/half HAS map: only-a-map.cave',
      'source/people/42 HAS connect-digest: abc @src:cave-connect'
    ].join('\n'))
    assert.deepEqual(Declared.declaredSources(store), [
      { name: 'people', path: 'data/people.csv', map: 'people.map.cave', key: 'id' },
      { name: 'verbs', path: 'verbs.cave' }
    ])
    assert.equal(Declared.describe(Declared.declaredSources(store)[0]!), 'people: data/people.csv --map people.map.cave --key id')
    assert.equal(Declared.describe({ name: 'staff', path: 'data/my people.csv', map: 'staff.map.cave' }), 'staff: "data/my people.csv" --map staff.map.cave', 'a path with whitespace is quoted so the listing pastes back')
    assert.equal(Declared.describe({ name: 'odd', path: 'data/a;backup.csv', map: 'x.cave', sql: 'SELECT "a" AS b, $1, `c` FROM records' }),
      'odd: "data/a;backup.csv" --map x.cave --sql "SELECT \\"a\\" AS b, \\$1, \\`c\\` FROM records"', 'shell punctuation is quoted, and what a double-quoted word still interprets is escaped')
    assert.equal(Declared.isCave({ name: 'verbs', path: 'verbs.cave' }), true)
    assert.equal(Declared.isCave({ name: 'x', path: 'x.txt', format: 'cave' }), true)
    assert.equal(Declared.isCave({ name: 'people', path: 'people.csv' }), false)
  } finally {
    store.close()
  }
})

test('invalid declared CSV refreshes preserve claims, digests and declaration ownership', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const source = join(dir, 'people.csv')
    writeFileSync(source, people)
    writeFileSync(join(dir, 'people.map.cave'), peopleMap)
    const store = open(db)
    try {
      store.ingest('source/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id')
      assemble(store, db)
      const declaration = Declared.declaredSources(store)[0]!
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      for (const malformed of [
        'id,name,company\n1,"unfinished',
        'id,name,company\n1,"ann"suffix,acme',
        'id,name,name\n1,ann,overwritten',
        'id,name,company\n1,ann,acme,discarded'
      ]) {
        writeFileSync(source, malformed)
        assert.throws(() => Declared.run(store, Declared.prepareSync(declaration, dir), { prune: true }), /CSV line/)
        assert.throws(() => assemble(store, db), error => error instanceof LocateError && /source\/people.*CSV line/.test(error.message))
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      writeFileSync(source, people)
      const recovered = Declared.run(store, Declared.prepareSync(declaration, dir), { prune: true })
      assert.equal(recovered.skipped, 2)
      assert.equal(recovered.pruned, 0)
      assert.equal(recovered.added, 0)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  })
})

test('invalid source encoding and SQL projections during refresh preserve declared source history', () => {
  withDir(dir => {
    const path = join(dir, 'k.db')
    const source = join(dir, 'people.csv')
    writeFileSync(source, people)
    writeFileSync(join(dir, 'people.map.cave'), peopleMap)
    const store = open(path)
    try {
      store.ingest('source/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id\nsource/people HAS sql: "SELECT *, name AS label FROM records"')
      assemble(store, path)
      const declaration = Declared.declaredSources(store)[0]!
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const mutation = { ...declaration, sql: 'DELETE FROM records' }
      assert.throws(() => Declared.run(store, Declared.prepareSync(mutation, dir), { prune: true }), /SQL source query must return columns/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      for (const invalid of ['id,name,company,label\n1,ann,acme,collision', 'id,name,company,label\n']) {
        writeFileSync(source, invalid)
        assert.throws(() => Declared.run(store, Declared.prepareSync(declaration, dir), { prune: true }), /duplicate SQL result column "label"/)
        assert.throws(() => assemble(store, path), error => error instanceof LocateError && /duplicate SQL result column "label"/.test(error.message))
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      writeFileSync(source, Buffer.concat([Buffer.from('id,name,company\n1,ann,'), Buffer.from([0xff])]))
      assert.throws(() => Declared.run(store, Declared.prepareSync(declaration, dir), { prune: true }), /invalid UTF-8/)
      assert.throws(() => assemble(store, path), error => error instanceof LocateError && /invalid UTF-8/.test(error.message))
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      writeFileSync(source, people)
      const recovered = Declared.run(store, Declared.prepareSync(declaration, dir), { prune: true })
      assert.equal(recovered.skipped, 2)
      assert.equal(recovered.pruned, 0)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  })
})

test('declared CAVE and mapping files reject invalid UTF-8 before refresh', () => {
  withDir(dir => {
    const store = open()
    try {
      writeFileSync(join(dir, 'people.csv'), people)
      for (const mapping of [false, true]) {
        const file = join(dir, mapping ? 'people.map.cave' : 'people.cave')
        writeFileSync(file, Buffer.concat([Buffer.from('api IS service ; invalid '), Buffer.from([0xff])]))
        const declaration = mapping ? { name: 'mapped', path: 'people.csv', map: 'people.map.cave', key: 'id' } : { name: 'cave', path: 'people.cave' }
        const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.throws(() => Declared.run(store, Declared.prepareSync(declaration, dir), { prune: true }), /invalid UTF-8/)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        writeFileSync(file, mapping ? peopleMap : 'api IS service')
        assert.equal(Declared.run(store, Declared.prepareSync(declaration, dir)).failures.length, 0)
      }
    } finally { store.close() }
  })
})

test('declared naming mirrors the stamp and the source entity (spec §23.4, §26.3)', () => {
  const naming = declaredNaming('people')
  assert.equal(naming.unit(), 'source/people')
  assert.equal(naming.unit('42'), 'source/people/42')
  assert.equal(naming.run(), 'people')
  assert.equal(naming.run('42'), 'people/42')
  assert.equal(naming.recordPrefix, 'source/people/')
})

test('a text store follows its declared sources, nested declarations included, and never re-reads itself', () => {
  withDir(dir => {
    mkdirSync(join(dir, 'data'))
    writeFileSync(join(dir, 'data', 'people.csv'), people)
    writeFileSync(join(dir, 'data', 'people.map.cave'), peopleMap)
    // verbs.cave declares a further source and points back at the root.
    writeFileSync(join(dir, 'verbs.cave'), [
      'WORKS-AT IS verb',
      'WORKS-AT REVERSE EMPLOYS',
      'source/people HAS path: data/people.csv',
      'source/people HAS map: data/people.map.cave',
      'source/people HAS key: id',
      'source/root HAS path: notes.cave'
    ].join('\n'))
    const root = join(dir, 'notes.cave')
    writeFileSync(root, 'acme IS company\nsource/verbs HAS path: verbs.cave\nsource/people HAS reliability: 80%\n')

    const store = openAt(root, { intent: 'read', assemble })
    try {
      const current = store.currentBeliefs().filter(row => row.conf > 0)
      const contexts = (subject: string, verb: string): string[] =>
        current.filter(row => row.subject === subject && row.verb === verb).map(row => store.toClaim(row).contexts.join(' '))
      assert.deepEqual(contexts('ann', 'WORKS-AT'), ['src:data/people.csv#L2 src:people/1'])
      assert.deepEqual(contexts('bob', 'WORKS-AT'), ['src:data/people.csv#L3 src:people/2'])
      assert.deepEqual(contexts('WORKS-AT', 'REVERSE'), ['src:verbs'], 'a .cave source stamps its name')
      assert.equal(current.filter(row => row.subject === 'acme' && row.verb === 'IS').length, 1, 'the root file is never followed as a source of itself')
      assert.equal(store.reverse('acme').some(fact => fact.rel === 'EMPLOYS' && fact.source === 'ann'), true, 'the imported REVERSE declaration is live')
      assert.deepEqual(Declared.declaredSources(store).map(source => source.name), ['people', 'root', 'verbs'])
    } finally {
      store.close()
    }
  })
})

test('assembly failures are usage failures naming the source', () => {
  withDir(dir => {
    const root = join(dir, 'notes.cave')
    writeFileSync(root, 'source/people HAS path: missing.csv\nsource/people HAS map: people.map.cave\n')
    assert.throws(() => openAt(root, { intent: 'read', assemble }), error => {
      assert.ok(error instanceof LocateError)
      assert.match(error.message, /^source\/people \(missing\.csv\): /)
      return true
    })
    writeFileSync(root, 'source/people HAS path: people.csv\n')
    writeFileSync(join(dir, 'people.csv'), people)
    assert.throws(() => openAt(root, { intent: 'read', assemble }), /source\/people \(people\.csv\): a map is required/)
    writeFileSync(root, 'source/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS format: xml\n')
    assert.throws(() => openAt(root, { intent: 'read', assemble }), /unknown format "xml"/)
    writeFileSync(root, 'source/bad HAS path: bad.cave\n')
    writeFileSync(join(dir, 'bad.cave'), 'this is not\n')
    assert.throws(() => openAt(root, { intent: 'read', assemble }), /source\/bad \(bad\.cave\): the \.cave source does not parse/)
  })
})

test('a changed .cave source retracts what it no longer says; a pruned record retracts its claims', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'facts.cave'), 'x IS old\ny IS kept\n')
    writeFileSync(join(dir, 'people.csv'), people)
    writeFileSync(join(dir, 'people.map.cave'), peopleMap)
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      store.ingest('source/facts HAS path: facts.cave\nsource/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id')
      assemble(store, db)
      const current = (): string[] => store.currentBeliefs().filter(row => row.conf > 0).map(row => `${row.subject} ${row.verb} ${row.object ?? ''}`.trim()).sort()
      assert.ok(current().includes('x IS old') && current().includes('bob WORKS-AT globex'))

      writeFileSync(join(dir, 'facts.cave'), 'y IS kept\nz IS new\n')
      writeFileSync(join(dir, 'people.csv'), 'id,name,company\n1,ann,initech\n')
      const second = assemble(store, db, { force: false })
      // assemble never prunes; a run with prune does.
      assert.ok(current().includes('z IS new') && !current().includes('x IS old'), 'the .cave source is a lifecycle unit')
      assert.ok(current().includes('ann WORKS-AT initech') && !current().includes('ann WORKS-AT acme'))
      assert.ok(current().includes('bob WORKS-AT globex'), 'without prune a vanished record stays')
      assert.equal(second.find(entry => entry.declared.name === 'facts')?.report.retracted, 1)

      const ready = Declared.prepareSync({ name: 'people', path: 'people.csv', map: 'people.map.cave', key: 'id' }, dir)
      const pruned = Declared.run(store, ready, { prune: true })
      assert.equal(pruned.pruned, 1)
      assert.ok(!current().includes('bob WORKS-AT globex'), 'prune retracts the vanished record by its run')
    } finally {
      store.close()
    }
  })
})

test('assembly skips URL sources and follows one file under several names; declaredIn reads text', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'people.csv'), people)
    writeFileSync(join(dir, 'as-people.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'as-staff.map.cave'), '?name IS staff\n')
    const root = join(dir, 'notes.cave')
    writeFileSync(root, [
      'source/remote HAS path: https://example.test/people.csv',
      'source/remote HAS map: as-people.map.cave',
      'source/remote-cave HAS path: https://example.test/verbs.cave',
      'source/people HAS path: people.csv',
      'source/people HAS map: as-people.map.cave',
      'source/staff HAS path: people.csv',
      'source/staff HAS map: as-staff.map.cave'
    ].join('\n'))
    const store = openAt(root, { intent: 'read', assemble })
    try {
      const current = store.currentBeliefs().filter(row => row.conf > 0)
      assert.equal(current.filter(row => row.subject === 'ann' && row.verb === 'IS').map(row => row.object).sort().join(','), 'person,staff',
        'the same file is followed under each name')
      assert.equal(current.some(row => store.toClaim(row).contexts.some(context => context.startsWith('src:remote'))), false,
        'URL sources are skipped during assembly, not errors')
    } finally {
      store.close()
    }
    assert.deepEqual(Declared.declaredIn('x IS y\nsource/a HAS path: a.cave\nsource/b HAS map: only.cave\n'), [{ name: 'a', path: 'a.cave' }])
  })
})

test('a .cave source that becomes empty retracts everything it owned', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'facts.cave'), 'x IS old\n')
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      store.ingest('source/facts HAS path: facts.cave')
      assemble(store, db)
      const current = (): string[] => store.currentBeliefs().filter(row => row.conf > 0).map(row => `${row.subject} ${row.verb} ${row.object ?? ''}`.trim())
      assert.ok(current().includes('x IS old'))
      writeFileSync(join(dir, 'facts.cave'), '')
      const emptied = assemble(store, db)
      assert.equal(emptied.find(entry => entry.declared.name === 'facts')?.report.retracted, 1)
      assert.ok(!current().includes('x IS old'), 'an empty source says nothing, so its claims retract')
      assert.deepEqual(assemble(store, db).find(entry => entry.declared.name === 'facts')?.report.notes, ['prelude unchanged, skipped'], 'and the empty state is remembered')
    } finally {
      store.close()
    }
  })
})

test('discover can skip what the store already followed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    writeFileSync(join(dir, 'a.cave'), 'a IS b\n')
    writeFileSync(join(dir, 'c.cave'), 'c IS d\n')
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      store.ingest('source/a HAS path: a.cave\nsource/c HAS path: c.cave')
      Declared.run(store, Declared.prepareSync({ name: 'a', path: 'a.cave' }, dir))
      const left = await Declared.discover(store, db, { skipFollowed: true })
      assert.deepEqual(left.map(entry => entry.declared.name), ['c'])
      const all = await Declared.discover(store, db)
      assert.deepEqual(all.map(entry => entry.declared.name), ['a', 'c'])
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a followed .cave source may re-declare a source: the current declaration runs, whichever order names sort in', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'old.cave'), 'answer IS old\n')
    writeFileSync(join(dir, 'new.cave'), 'answer IS new\n')
    // `a` sorts before `b`: the re-declaration lands before b runs.
    writeFileSync(join(dir, 'a.cave'), 'source/b HAS path: new.cave\n')
    // `z` sorts after `b`: b runs with the old path first, then runs again.
    writeFileSync(join(dir, 'z.cave'), 'source/b HAS path: new.cave\n')
    for (const redeclarer of ['a', 'z']) {
      const root = join(dir, `${redeclarer}-root.cave`)
      writeFileSync(root, `source/b HAS path: old.cave\nsource/${redeclarer} HAS path: ${redeclarer}.cave\n`)
      const store = openAt(root, { intent: 'read', assemble })
      try {
        const answers = store.currentBeliefs().filter(row => row.conf > 0 && row.subject === 'answer').map(row => row.object)
        assert.deepEqual(answers, ['new'], `re-declared through ${redeclarer}: only the current declaration's claims are current`)
      } finally {
        store.close()
      }
    }
  })
})

test('discover applies nested re-declarations and treats record-only sources as followed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    writeFileSync(join(dir, 'old.cave'), 'answer IS old\n')
    writeFileSync(join(dir, 'new.cave'), 'answer IS new\n')
    writeFileSync(join(dir, 'z.cave'), 'source/b HAS path: new.cave\n')
    writeFileSync(join(dir, 'people.csv'), people)
    writeFileSync(join(dir, 'people.map.cave'), peopleMap)
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      store.ingest('source/b HAS path: old.cave\nsource/z HAS path: z.cave\nsource/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id')
      const ready = await Declared.discover(store, db)
      assert.deepEqual(ready.map(entry => [entry.declared.name, entry.declared.path]), [['b', 'old.cave'], ['people', 'people.csv'], ['z', 'z.cave'], ['b', 'new.cave']], 'the run sequence: b runs under the old path, z re-declares it, b runs again under the new one')
      Declared.run(store, Declared.prepareSync({ name: 'people', path: 'people.csv', map: 'people.map.cave', key: 'id' }, dir))
      assert.equal(Declared.followed(store, { name: 'people', path: 'people.csv', map: 'people.map.cave', key: 'id' }), true, 'the run recorded its declaration — the mapping has no prelude')
      assert.equal(Declared.followed(store, { name: 'b', path: 'old.cave' }), false)
      const left = await Declared.discover(store, db, { skipFollowed: true })
      assert.deepEqual(left.map(entry => entry.declared.name), ['b', 'z', 'b'], 'people is skipped; b runs, z re-declares it, b runs again')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a nested source name is refused: it would collide with a record key', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'x.cave'), 'x IS y\n')
    const root = join(dir, 'notes.cave')
    writeFileSync(root, 'source/team/admin HAS path: x.cave\n')
    assert.throws(() => openAt(root, { intent: 'read', assemble }), /source\/team\/admin \(x\.cave\): source names are one path segment — source\/team\/admin would collide with record "admin" of source\/team/)
  })
})

test('a nested text that changes one attribute of a known source is a delta: discovery and --name follow the merged declaration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    writeFileSync(join(dir, 'people.csv'), people)
    writeFileSync(join(dir, 'as-person.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'as-staff.map.cave'), '?name IS staff\n')
    writeFileSync(join(dir, 'remap.cave'), 'source/people HAS map: as-staff.map.cave\n')
    assert.deepEqual(Declared.declarationsIn('source/people HAS map: as-staff.map.cave\n'), [{ name: 'people', fields: { map: 'as-staff.map.cave' } }])
    assert.deepEqual(Declared.declaredIn('source/people HAS map: as-staff.map.cave\n'), [], 'without a path it is not a declaration on its own')
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      store.ingest('source/people HAS path: people.csv\nsource/people HAS map: as-person.map.cave\nsource/remap HAS path: remap.cave')
      const ready = await Declared.discover(store, db)
      assert.equal(ready.filter(entry => entry.declared.name === 'people').at(-1)?.declared.map, 'as-staff.map.cave', 'the delta is applied over the known declaration, and people runs again under it')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discovery keeps the store\'s precedence: an unchanged followed source does not override a newer root declaration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    writeFileSync(join(dir, 'old.cave'), 'answer IS old\n')
    writeFileSync(join(dir, 'new.cave'), 'answer IS new\n')
    writeFileSync(join(dir, 'newer.cave'), 'answer IS newer\n')
    writeFileSync(join(dir, 'z.cave'), 'source/b HAS path: new.cave\n')
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      store.ingest('source/b HAS path: old.cave\nsource/z HAS path: z.cave', { source: 'cli' })
      assemble(store, db)
      assert.equal(Declared.declaredSources(store).find(declared => declared.name === 'b')?.path, 'new.cave', 'the followed source re-declared b')
      // The root re-declares b later; z is unchanged, so a pass skips it.
      store.ingest('source/b HAS path: newer.cave', { source: 'cli' })
      assert.equal(Declared.declaredSources(store).find(declared => declared.name === 'b')?.path, 'newer.cave', 'the newest current claim wins')
      const ready = await Declared.discover(store, db)
      assert.equal(ready.filter(entry => entry.declared.name === 'b').at(-1)?.declared.path, 'newer.cave', 'discovery does not re-apply the unchanged text over the newer claim')
      const forced = await Declared.discover(store, db, { force: true })
      assert.equal(forced.filter(entry => entry.declared.name === 'b').at(-1)?.declared.path, 'new.cave', 'a forced pass re-applies z, and its claim is then the newest')
      // A retraction inside a followed text touches its own series only.
      writeFileSync(join(dir, 'z.cave'), 'source/b HAS path: new.cave @ 0%\n')
      const retracting = await Declared.discover(store, db)
      assert.equal(retracting.filter(entry => entry.declared.name === 'b').at(-1)?.declared.path, 'newer.cave', "the root's series is untouched by z's retraction")
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('many independent sources are not a cycle; a source re-declared past the cap is', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'fact.cave'), 'x IS y\n')
    const many = Array.from({ length: 60 }, (_, i) => `source/s${i} HAS path: fact.cave`).join('\n')
    const root = join(dir, 'many.cave')
    writeFileSync(root, `${many}\n`)
    const store = openAt(root, { intent: 'read', assemble })
    try {
      assert.equal(Declared.declaredSources(store).length, 60, 'well past the per-source cap, and no cycle')
    } finally {
      store.close()
    }
    // a and b re-declare each other's path around a four-file ring:
    // a1 → b2 → a2 → b1 → a1 …, so neither declaration ever settles.
    writeFileSync(join(dir, 'a1.cave'), 'source/b HAS path: b2.cave\n')
    writeFileSync(join(dir, 'b2.cave'), 'source/a HAS path: a2.cave\n')
    writeFileSync(join(dir, 'a2.cave'), 'source/b HAS path: b1.cave\n')
    writeFileSync(join(dir, 'b1.cave'), 'source/a HAS path: a1.cave\n')
    const cyclic = join(dir, 'cyclic.cave')
    writeFileSync(cyclic, 'source/a HAS path: a1.cave\nsource/b HAS path: b1.cave\n')
    assert.throws(() => openAt(cyclic, { intent: 'read', assemble }), /keeps being re-declared — no fixed point after 20 re-declarations/)
  })
})

test('discovery follows a source removing a declaration it made, and keeps the run order the overlay must replay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    // a (which sorts before b) declares b; the store followed a, then a
    // drops the line: the pass runs a first and retracts b's declaration,
    // so nothing must load b any more.
    writeFileSync(join(dir, 'b.cave'), 'b IS here\n')
    writeFileSync(join(dir, 'a.cave'), 'source/b HAS path: b.cave\n')
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      store.ingest('source/a HAS path: a.cave')
      assemble(store, db)
      assert.deepEqual(Declared.declaredSources(store).map(declared => declared.name), ['a', 'b'])
      writeFileSync(join(dir, 'a.cave'), 'a IS quiet\n')
      const ready = await Declared.discover(store, db)
      assert.deepEqual(ready.map(entry => entry.declared.name), ['a'], 'b is retracted by the replayed pass, so it is not loaded')
      assert.deepEqual(Declared.declaredSources(store).map(declared => declared.name), ['a', 'b'], 'and the store itself is untouched')
    } finally {
      store.close()
    }
    // a(a1) declares c=c1; z re-declares a=a2, which declares c=c2: the
    // sequence is a, c, z, a, c and replaying it in that order ends with c2.
    writeFileSync(join(dir, 'c1.cave'), 'c IS one\n')
    writeFileSync(join(dir, 'c2.cave'), 'c IS two\n')
    writeFileSync(join(dir, 'a1.cave'), 'source/c HAS path: c1.cave\n')
    writeFileSync(join(dir, 'a2.cave'), 'source/c HAS path: c2.cave\n')
    writeFileSync(join(dir, 'zz.cave'), 'source/a HAS path: a2.cave\n')
    const db2 = join(dir, 'k2.db')
    const store2 = open(db2)
    try {
      store2.ingest('source/a HAS path: a1.cave\nsource/z HAS path: zz.cave')
      const sequence = await Declared.discover(store2, db2, { force: true })
      assert.deepEqual(sequence.map(entry => [entry.declared.name, entry.declared.path]), [['a', 'a1.cave'], ['c', 'c1.cave'], ['z', 'zz.cave'], ['a', 'a2.cave'], ['c', 'c2.cave']], 'the pass order: c (declared by a) sorts before z and runs first')
      store2.transaction(() => {
        for (const ready of sequence) Declared.run(store2, ready, { force: true })
        assert.deepEqual(store2.currentBeliefs().filter(row => row.conf > 0 && row.subject === 'c').map(row => row.object), ['two'], 'replaying the sequence in order ends where the pass ends')
        throw new Error('rollback')
      })
    } catch (error) {
      if (!(error instanceof Error && error.message === 'rollback')) throw error
    } finally {
      store2.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a text store overlay loads a followed source again when a URL source re-declares it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    writeFileSync(join(dir, 'people.csv'), people)
    writeFileSync(join(dir, 'as-person.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'as-staff.map.cave'), '?name IS staff\n')
    const root = join(dir, 'notes.cave')
    writeFileSync(root, 'source/people HAS path: people.csv\nsource/people HAS map: as-person.map.cave\nsource/remote HAS path: https://example.test/remap.cave\n')
    const store = openAt(root, { intent: 'scratch', assemble })
    try {
      assert.equal(Declared.followed(store, { name: 'people', path: 'people.csv', map: 'as-person.map.cave' }), true)
      const fetchImpl = async (): Promise<Response> =>
        new Response('source/people HAS map: as-staff.map.cave\n', { status: 200, headers: { 'content-type': 'text/plain' } })
      const sequence = await Declared.discover(store, root, { skipFollowed: true, force: true, fetchImpl })
      assert.deepEqual(sequence.map(entry => [entry.declared.name, entry.declared.map ?? '']), [['remote', ''], ['people', 'as-staff.map.cave']],
        'the followed baseline is skipped, the re-declared version is loaded')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a nested name is refused even when the declaration would be skipped as a URL or as already followed', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'team.csv'), 'id,name\nadmin,ann\n')
    writeFileSync(join(dir, 'team.map.cave'), '?name IS person\n')
    const root = join(dir, 'notes.cave')
    writeFileSync(root, 'source/team HAS path: team.csv\nsource/team HAS map: team.map.cave\nsource/team HAS key: id\nsource/team/admin HAS path: https://example.test/admin.cave\n')
    assert.throws(() => openAt(root, { intent: 'read', assemble }), /source\/team\/admin \(https:\/\/example\.test\/admin\.cave\): source names are one path segment/)
  })
})

test('followed means followed under this very declaration, not merely digests left by an earlier version', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    const remote = { name: 'remote', path: 'https://example.test/x.cave' }
    const store = open()
    try {
      store.ingest('source/remote HAS path: https://example.test/x.cave\nsource/remote/1 HAS note: hello @src:cave-connect\nsource/remote/1 HAS connect-digest: abc @src:cave-connect')
      assert.equal(Declared.followed(store, remote), false, 'digests and authored bookkeeping claims prove nothing about this declaration')
      store.ingest(`source/remote HAS connect-declaration: ${Declared.declarationDigest(remote)} @src:cave-connect`)
      assert.equal(Declared.followed(store, remote), true)
      assert.equal(Declared.followed(store, { ...remote, map: 'x.map.cave' }), false, 'a different declaration is a different source version')
    } finally {
      store.close()
    }
    // A text store assembles b as a local file, then a later text re-declares
    // b as a URL: assembly skips the URL, and the overlay must fetch it.
    writeFileSync(join(dir, 'people.csv'), people)
    writeFileSync(join(dir, 'people.map.cave'), peopleMap)
    writeFileSync(join(dir, 'z.cave'), 'source/b HAS path: https://example.test/b.cave\nsource/b HAS map: people.map.cave @ 0%\n')
    const root = join(dir, 'notes.cave')
    writeFileSync(root, 'source/b HAS path: people.csv\nsource/b HAS map: people.map.cave\nsource/z HAS path: z.cave\n')
    const text = openAt(root, { intent: 'scratch', assemble })
    try {
      assert.equal(Declared.declaredSources(text).find(declared => declared.name === 'b')?.path, 'https://example.test/b.cave')
      const sequence = await Declared.discover(text, root, { skipFollowed: true, force: true, fetchImpl: async () => new Response('b IS remote\n', { status: 200 }) })
      assert.deepEqual(sequence.map(entry => entry.declared.name), ['b'], 'the URL version of b is fetched, its local digests notwithstanding')
    } finally {
      text.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a declaration that goes away and comes back within one discovery runs again after the intervening version', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    writeFileSync(join(dir, 'people.csv'), people)
    writeFileSync(join(dir, 'as-person.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'as-staff.map.cave'), '?name IS staff\n')
    const root = join(dir, 'notes.cave')
    writeFileSync(root, [
      'source/b HAS path: people.csv',
      'source/b HAS map: as-staff.map.cave',
      'source/u1 HAS path: https://example.test/u1.cave',
      'source/u2 HAS path: https://example.test/u2.cave'
    ].join('\n'))
    const store = openAt(root, { intent: 'scratch', assemble })
    try {
      const texts: Record<string, string> = {
        'https://example.test/u1.cave': 'source/b HAS map: as-person.map.cave\n',
        'https://example.test/u2.cave': 'source/b HAS map: as-staff.map.cave\n'
      }
      const fetchImpl = async (url: string): Promise<Response> => new Response(texts[url] ?? '', { status: 200 })
      const sequence = await Declared.discover(store, root, { skipFollowed: true, force: true, fetchImpl })
      assert.deepEqual(sequence.map(entry => [entry.declared.name, entry.declared.map ?? '']),
        [['u1', ''], ['b', 'as-person.map.cave'], ['u2', ''], ['b', 'as-staff.map.cave']],
        'b runs under the intervening map and again under the restored one')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discovery with prune drops the sources a vanished record declared', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    writeFileSync(join(dir, 'zchild.cave'), 'child IS here\n')
    writeFileSync(join(dir, 'registry.csv'), 'entity,path\nsource/zchild,zchild.cave\n')
    writeFileSync(join(dir, 'registry.map.cave'), '?entity HAS path: ?path\n')
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      store.ingest('source/registry HAS path: registry.csv\nsource/registry HAS map: registry.map.cave\nsource/registry HAS key: entity')
      assemble(store, db)
      assert.deepEqual(Declared.declaredSources(store).map(declared => declared.name), ['registry', 'zchild'])
      writeFileSync(join(dir, 'registry.csv'), 'entity,path\n')
      const kept = await Declared.discover(store, db)
      assert.deepEqual(kept.map(entry => entry.declared.name), ['registry', 'zchild'], 'without prune the vanished record keeps its declaration')
      const pruned = await Declared.discover(store, db, { prune: true })
      assert.deepEqual(pruned.map(entry => entry.declared.name), ['registry'], 'the registry runs first and prunes the record, so the child it declared is gone, as in the pass')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discovery runs each source once: the work grows with the sources, not with their square', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    const count = 40
    for (let i = 0; i < count; i += 1) writeFileSync(join(dir, `s${i}.cave`), `fact${i} IS true\n`)
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      store.ingest(Array.from({ length: count }, (_, i) => `source/s${i} HAS path: s${i}.cave`).join('\n'))
      let ingests = 0
      const counting = new Proxy(store, {
        get: (target, key, receiver) => key === 'ingest' ?
          (...args: Parameters<typeof store.ingest>) => { ingests += 1; return target.ingest(...args) } :
          Reflect.get(target, key, receiver)
      })
      const sequence = await Declared.discover(counting, db, { force: true })
      assert.equal(sequence.length, count)
      assert.ok(ingests <= 3 * count, `${ingests} ingests for ${count} sources — each ran once (prelude, digest, declaration marker), not once per round`)
      assert.equal(store.currentBeliefs().filter(row => row.subject.startsWith('fact')).length, 0, 'and nothing stayed')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discovery holds no lock on the real store while a source loads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      store.ingest('source/remote HAS path: https://example.test/slow.cave')
      let release: () => void = () => {}
      const gate = new Promise<void>(resolve => { release = resolve })
      const fetchImpl = async (): Promise<Response> => {
        await gate
        return new Response('slow IS done\n', { status: 200 })
      }
      const pending = Declared.discover(store, db, { fetchImpl })
      await new Promise(resolve => setImmediate(resolve))
      // A second connection writes while the fetch is still pending.
      const writer = open(db)
      try {
        writer.ingest('meanwhile IS written')
      } finally {
        writer.close()
      }
      release()
      const sequence = await pending
      assert.deepEqual(sequence.map(entry => entry.declared.name), ['remote'])
      assert.equal(store.currentBeliefs().some(row => row.subject === 'meanwhile'), true)
      assert.equal(store.currentBeliefs().some(row => row.subject === 'slow'), false, 'the snapshot copy was discarded')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a source re-declared to another path retires the records its previous version produced', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'old.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'new.csv'), 'id,name\n2,bob\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'z.cave'), 'source/b HAS path: new.csv\n')
    const root = join(dir, 'notes.cave')
    writeFileSync(root, 'source/b HAS path: old.csv\nsource/b HAS map: people.map.cave\nsource/b HAS key: id\nsource/z HAS path: z.cave\n')
    const store = openAt(root, { intent: 'read', assemble })
    try {
      const people = store.currentBeliefs().filter(row => row.conf > 0 && row.verb === 'IS' && row.object === 'person').map(row => row.subject)
      assert.deepEqual(people, ['bob'], "ann came from b's previous version and is retired with it")
    } finally {
      store.close()
    }
  })
})

test('a followed source without a recorded declaration is treated as changed when it runs again', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'old.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'new.csv'), 'id,name\n2,bob\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n')
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      Declared.run(store, Declared.prepareSync({ name: 'b', path: 'old.csv', map: 'people.map.cave', key: 'id' }, dir))
      // A store followed before declarations were recorded: digests, no marker.
      store.ingest(`source/b HAS ${Declared.declarationAttribute}: ${Declared.recordedDeclaration(store, 'b')} @src:cave-connect @ 0%`)
      assert.equal(Declared.recordedDeclaration(store, 'b'), undefined)
      Declared.run(store, Declared.prepareSync({ name: 'b', path: 'new.csv', map: 'people.map.cave', key: 'id' }, dir))
      const people = store.currentBeliefs().filter(row => row.conf > 0 && row.verb === 'IS' && row.object === 'person').map(row => row.subject)
      assert.deepEqual(people, ['bob'], 'the old record is retired although no declaration was recorded')
    } finally {
      store.close()
    }
  })
})

test('a .cave source re-declared as a record source retires its former prelude', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'facts.cave'), 'fact IS old\n')
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'z.cave'), 'source/b HAS path: people.csv\nsource/b HAS map: people.map.cave\nsource/b HAS key: id\n')
    const root = join(dir, 'notes.cave')
    writeFileSync(root, 'source/b HAS path: facts.cave\nsource/z HAS path: z.cave\n')
    const store = open()
    try {
      store.ingest('source/b HAS path: facts.cave\nsource/z HAS path: z.cave')
      const assembled = assemble(store, root)
      const current = store.currentBeliefs().filter(row => row.conf > 0 && ['fact', 'ann'].includes(row.subject)).map(row => `${row.subject} ${row.verb} ${row.object}`)
      assert.deepEqual(current, ['ann IS person'], "b's former prelude claim is retired along with the .cave declaration")
      assert.equal(assembled.filter(entry => entry.declared.name === 'b').at(-1)?.report.retracted, 1, 'and the report counts the retirement')
    } finally {
      store.close()
    }
  })
})

test('a shape transition re-runs a same-text prelude, and the declaration marker is the connector\'s own series', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'facts.cave'), 'fact IS kept\n')
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'people.map.cave'), 'fact IS kept\n\n?name IS person\n')
    writeFileSync(join(dir, 'z.cave'), 'source/b HAS path: people.csv\nsource/b HAS map: people.map.cave\nsource/b HAS key: id\n')
    const root = join(dir, 'notes.cave')
    writeFileSync(root, 'source/b HAS path: facts.cave\nsource/z HAS path: z.cave\n')
    const store = openAt(root, { intent: 'read', assemble })
    try {
      const current = store.currentBeliefs().filter(row => row.conf > 0 && ['fact', 'ann'].includes(row.subject)).map(row => `${row.subject} ${row.verb} ${row.object}`).sort()
      assert.deepEqual(current, ['ann IS person', 'fact IS kept'], 'the prelude the new mapping still declares is current again despite the unchanged digest')
    } finally {
      store.close()
    }
    const scratch = open()
    try {
      scratch.ingest('source/x HAS path: x.cave\nsource/x HAS connect-declaration: authored\nsource/x HAS connect-declaration: emitted @src:x')
      assert.equal(Declared.recordedDeclaration(scratch, 'x'), undefined, 'only the @src:cave-connect series is the marker')
      scratch.ingest('source/x HAS connect-declaration: real @src:cave-connect')
      assert.equal(Declared.recordedDeclaration(scratch, 'x'), 'real')
    } finally {
      scratch.close()
    }
  })
})

test('assembly keeps source context when preparation errors cannot be formatted', t => {
  const store = open()
  const failure = Object.create(null)
  try {
    store.ingest('source/records HAS path: unprintable-records.cave')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const read = fs.readFileSync
    t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
      if (String(args[0]).endsWith('unprintable-records.cave')) throw failure
      return read(...args)
    })
    syncBuiltinESMExports()
    assert.throws(() => Declared.assemble(store, ':memory:'), error => {
      assert.ok(error instanceof LocateError)
      assert.match(error.message, /source\/records \(unprintable-records.cave\): \[unprintable thrown value\]/)
      assert.equal(error.cause, failure)
      return true
    })
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    store.ingest('caller IS usable')
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); store.close() }
})

for (const reader of ['declarationsIn', 'declaredIn'] as const) {
  for (const invalid of [false, true]) {
    for (const unprintable of [false, true]) test(`${reader} preserves scratch read and close failures (invalid=${invalid}, unprintable=${unprintable})`, t => {
      const text = invalid ? 'source/\ud800 HAS path: x.cave' : 'source/x HAS path: x.cave'
      let original: Error | undefined
      if (invalid) assert.throws(() => Declared[reader](text), error => {
        assert.ok(error instanceof Error)
        original = error
        return true
      })
      else Declared[reader](text) // Initialize the native probe before fault injection.
      const closeError = new Error('declaration scratch close failed')
      if (unprintable) Object.defineProperty(closeError, 'message', { value: Object.create(null) })
      const close = DatabaseSync.prototype.close
      let closes = 0
      try {
        t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
          close.call(this)
          closes++
          throw closeError
        })
        assert.throws(() => Declared[reader](text), error => {
          if (original === undefined) assert.equal(error, closeError)
          else {
            assert.ok(error instanceof AggregateError)
            assert.equal(error.errors.length, 2)
            assert.equal(error.errors[0].constructor, original.constructor)
            assert.equal(error.errors[0].message, original.message)
            assert.equal(error.errors[1], closeError)
            assert.equal(error.cause, error.errors[0])
            assert.ok(error.message.includes(original.message))
            assert.ok(error.message.includes(unprintable ? '[unprintable thrown value]' : closeError.message))
          }
          return true
        })
        assert.equal(closes, 1)
      } finally { t.mock.restoreAll() }
      assert.deepEqual(Declared.declaredIn('source/x HAS path: x.cave'), [{ name: 'x', path: 'x.cave' }])
    })
  }
}

for (const mode of ['copy-remove', 'read-close', 'close-remove', 'read-close-remove', 'read-close-remove-unprintable', 'close', 'remove'] as const) {
  test(`discovery preserves failures and attempts all snapshot cleanup: ${mode}`, async t => {
    const store = open()
    const created: string[] = []
    const operationError = new Error('snapshot operation failed')
    const closeError = new Error('snapshot close failed')
    const removeError = new Error('snapshot removal failed')
    if (mode.endsWith('unprintable')) {
      Object.defineProperty(operationError, 'message', { value: Object.create(null) })
      Object.defineProperty(closeError, 'message', { get() { throw new Error('message unavailable') } })
    }
    let closes = 0, removals = 0
    try {
      store.ingest('source/x HAS path: https://records.test/x.cave')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const makeDirectory = fs.mkdtempSync, remove = fs.rmSync
      t.mock.method(fs, 'mkdtempSync', (...args: Parameters<typeof fs.mkdtempSync>) => {
        const path = makeDirectory(...args)
        if (String(args[0]).endsWith('cave-discover-')) created.push(String(path))
        return path
      })
      t.mock.method(fs, 'rmSync', (...args: Parameters<typeof fs.rmSync>) => {
        if (created.includes(String(args[0]))) {
          removals++
          if (mode.includes('remove')) throw removeError
        }
        return remove(...args)
      })
      const close = DatabaseSync.prototype.close
      t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
        const path = this.location()
        close.call(this)
        if (path !== null && basename(path) === 'snapshot.db' && mode.includes('close')) {
          closes++
          throw closeError
        }
      })
      syncBuiltinESMExports()
      const origin = mode === 'copy-remove' ? new Proxy(store, {
        get: (target, key, receiver) => key === 'adapter' ?
          { ...target.adapter, capabilities: { ...target.adapter.capabilities, backup: { ...target.adapter.capabilities.backup!, write: () => { throw operationError } } } } :
          Reflect.get(target, key, receiver)
      }) : store
      const expected = [
        ...(mode === 'copy-remove' || mode.startsWith('read') ? [operationError] : []),
        ...(mode.includes('close') ? [closeError] : []),
        ...(mode.includes('remove') ? [removeError] : [])
      ]
      await assert.rejects(Declared.discover(origin, ':memory:', {
        fetchImpl: async () => {
          if (mode.startsWith('read')) throw operationError
          return new Response('fact IS discovered\n')
        }
      }), error => {
        if (expected.length === 1) assert.equal(error, expected[0])
        else {
          assert.ok(error instanceof AggregateError)
          if (mode.startsWith('read')) {
            const located = error.errors[0]
            assert.ok(located instanceof LocateError)
            assert.match(located.message, /source\/x \(https:\/\/records.test\/x.cave\)/)
            assert.equal(located.cause, operationError)
            expected[0] = located
          }
          assert.deepEqual(error.errors, expected)
          assert.equal(error.cause, expected[0])
          if (mode.endsWith('unprintable')) {
            assert.ok(error.message.includes('[unprintable thrown value]'))
            assert.ok(error.message.includes(removeError.message))
          } else for (const failure of expected) assert.ok(error.message.includes(failure.message))
        }
        return true
      })
      assert.equal(closes, mode.includes('close') ? 1 : 0)
      assert.equal(removals, 1)
      assert.equal(created.length, 1)
      assert.equal(existsSync(created[0]!), mode.includes('remove'))
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      store.ingest('caller IS usable')
    } finally {
      t.mock.restoreAll()
      syncBuiltinESMExports()
      for (const path of created) rmSync(path, { recursive: true, force: true })
      store.close()
    }
  })
}

test('a failed snapshot leaves no temporary directory behind', async t => {
  const store = open()
  const created: string[] = []
  try {
    store.ingest('source/x HAS path: x.cave')
    const makeDirectory = fs.mkdtempSync
    t.mock.method(fs, 'mkdtempSync', (...args: Parameters<typeof fs.mkdtempSync>) => {
      const path = makeDirectory(...args)
      if (String(args[0]).endsWith('cave-discover-')) created.push(String(path))
      return path
    })
    syncBuiltinESMExports()
    const failing = new Proxy(store, {
      get: (target, key, receiver) => key === 'adapter' ?
        { ...target.adapter, capabilities: { ...target.adapter.capabilities, backup: { ...target.adapter.capabilities.backup!, write: () => { throw new Error('disk full') } } } } :
        Reflect.get(target, key, receiver)
    })
    await assert.rejects(Declared.discover(failing, ':memory:'), /disk full/)
    assert.equal(created.length, 1)
    assert.equal(existsSync(created[0]!), false, 'the owned snapshot directory was removed')
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    for (const path of created) rmSync(path, { recursive: true, force: true })
    store.close()
  }
})

test('the overlay baseline includes ownership, so an ownership-only change is a change', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-'))
  try {
    writeFileSync(join(dir, 'child.cave'), 'child IS here\n')
    writeFileSync(join(dir, 'a.cave'), 'source/child HAS path: child.cave\n')
    writeFileSync(join(dir, 'b.cave'), 'source/child HAS path: child.cave\n')
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      store.ingest('source/a HAS path: a.cave\nsource/b HAS path: b.cave')
      Declared.run(store, Declared.prepareSync({ name: 'a', path: 'a.cave' }, dir))
      const before = Declared.declarationState(store)
      assert.equal(Declared.signatures(Declared.declaredSources(store)).get('child'), Declared.signature({ name: 'child', path: 'child.cave' }))
      Declared.run(store, Declared.prepareSync({ name: 'b', path: 'b.cave' }, dir))
      const after = Declared.declarationState(store)
      assert.equal(Declared.sameDeclarations(Declared.signatures(Declared.declaredSources(store)), Declared.signatures(Declared.declaredSources(store))), true)
      assert.equal(Declared.sameDeclarations(before, after), false, 'the same declaration re-emitted by another owner changes the state the overlay checks')
      // A latent input changes too: a partial delta with no path yet.
      const latent = Declared.declarationState(store)
      store.ingest('source/child HAS key: id @src:elsewhere')
      assert.equal(Declared.sameDeclarations(latent, Declared.declarationState(store)), false, 'a shadowed or partial source claim is part of the state')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a transition whose replacement fails to ingest keeps the last good data', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'facts.cave'), 'fact IS old\n')
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    // The new mapping's prelude contradicts the standard registry: CONTAINS already has an inverse.
    writeFileSync(join(dir, 'bad.map.cave'), 'CONTAINS REVERSE ELSEWHERE\n\n?name IS person\n')
    const db = join(dir, 'k.db')
    const store = open(db)
    try {
      store.ingest('source/b HAS path: facts.cave')
      assemble(store, db)
      assert.ok(store.currentBeliefs().some(row => row.conf > 0 && row.subject === 'fact'))
      assert.throws(() => Declared.run(store, Declared.prepareSync({ name: 'b', path: 'people.csv', map: 'bad.map.cave', key: 'id' }, dir)), /prelude failed to ingest/)
      const current = store.currentBeliefs().filter(row => row.conf > 0 && ['fact', 'ann'].includes(row.subject)).map(row => `${row.subject} ${row.verb} ${row.object}`)
      assert.deepEqual(current, ['fact IS old'], 'the former prelude is not retired when its replacement fails')
      assert.equal(Declared.recordedDeclaration(store, 'b'), Declared.declarationDigest({ name: 'b', path: 'facts.cave' }), 'the recorded declaration is still the old one')
    } finally {
      store.close()
    }
  })
})

test('a declaration transition with a failed record rolls back the entire replacement', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'facts.cave'), 'fact IS old\n')
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n,bob\n')
    const previous = { name: 'b', path: 'facts.cave' }
    const replacement = { name: 'b', path: 'people.csv', map: '?name IS person', key: 'id' }
    const store = open(join(dir, 'k.db'))
    try {
      Declared.run(store, Declared.prepareSync(previous, dir))
      const before = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
      assert.throws(() => Declared.run(store, Declared.prepareSync(replacement, dir)), /replacement failed/)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), before,
        'retirement, valid replacement records, and bookkeeping all roll back')
      assert.equal(Declared.recordedDeclaration(store, 'b'), Declared.declarationDigest(previous))

      writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n2,bob\n')
      const repaired = Declared.run(store, Declared.prepareSync(replacement, dir))
      assert.equal(repaired.mapped, 2)
      assert.equal(Declared.recordedDeclaration(store, 'b'), Declared.declarationDigest(replacement))
      const current = store.currentBeliefs().filter(row => row.conf > 0)
      assert.ok(!current.some(row => row.subject === 'fact'))
      assert.deepEqual(current.filter(row => row.object === 'person').map(row => row.subject).sort(), ['ann', 'bob'])
      const beforeRepeat = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
      const repeated = Declared.run(store, Declared.prepareSync(replacement, dir))
      assert.equal(repeated.mapped, 0)
      assert.equal(repeated.skipped, 2)
      assert.equal(repeated.retracted, 0)
      assert.equal(repeated.pruned, 0)
      assert.deepEqual(repeated.failures, [])
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), beforeRepeat,
        'an unchanged retry after repaired replacement must add no history')
    } finally { store.close() }
  })
})

test('a declared source may carry its mapping inline and reshape its records with sql', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'people.csv'), 'id,name,company\n1,ann,acme\n2,bob,globex\n')
    const root = join(dir, 'notes.cave')
    writeFileSync(root, [
      'source/people HAS path: people.csv',
      'source/people HAS map: `?name IS person, ?name WORKS-AT ?company`',
      'source/people HAS sql: "SELECT name, lower(company) AS company FROM records WHERE id = \'1\'"',
      'source/people HAS key: name'
    ].join('\n'))
    const store = openAt(root, { intent: 'read', assemble })
    try {
      const claims = store.currentBeliefs().filter(row => row.conf > 0 && ['ann', 'bob'].includes(row.subject)).map(row => `${row.subject} ${row.verb} ${row.object}`).sort()
      assert.deepEqual(claims, ['ann IS person', 'ann WORKS-AT acme'])
      assert.equal(Declared.describe(Declared.declaredSources(store)[0]!), 'people: people.csv --map "?name IS person, ?name WORKS-AT ?company" --key name --sql "SELECT name, lower(company) AS company FROM records WHERE id = \'1\'"')
    } finally {
      store.close()
    }
  })
})

test('a declared map naming an existing file is read as a file even when its name contains a comma', () => {
  withDir(dir => {
    mkdirSync(join(dir, 'maps'))
    writeFileSync(join(dir, 'maps', 'people,v2.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    const root = join(dir, 'notes.cave')
    writeFileSync(root, 'source/people HAS path: people.csv\nsource/people HAS map: maps/people,v2.cave\n')
    const store = openAt(root, { intent: 'read', assemble })
    try {
      assert.equal(store.currentBeliefs().some(row => row.conf > 0 && row.subject === 'ann' && row.object === 'person'), true)
    } finally {
      store.close()
    }
  })
})

test('malformed declared JSON refresh preserves ownership and permits an unchanged retry', () => withDir(dir => {
  const db = join(dir, 'k.db'), source = join(dir, 'people.json')
  const valid = JSON.stringify([{ id: 1, name: 'ann', company: 'acme' }, { id: 2, name: 'bob', company: 'globex' }])
  writeFileSync(source, valid)
  writeFileSync(join(dir, 'people.map.cave'), peopleMap)
  const store = open(db)
  try {
    store.ingest('source/people HAS path: people.json\nsource/people HAS map: people.map.cave\nsource/people HAS key: id')
    assemble(store, db)
    const declaration = Declared.declaredSources(store)[0]!
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    writeFileSync(source, '[{"id":1,"name":"changed","company":"other"},')
    assert.throws(() => Declared.run(store, Declared.prepareSync(declaration, dir), { prune: true }), error =>
      error instanceof SyntaxError && error.message.startsWith(`${source}: invalid JSON — `))
    assert.throws(() => assemble(store, db), error =>
      error instanceof LocateError && error.message.includes('source/people') && error.message.includes(`${source}: invalid JSON — `))
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    writeFileSync(source, valid)
    const retry = Declared.run(store, Declared.prepareSync(declaration, dir), { prune: true })
    assert.equal(retry.skipped, 2)
    assert.equal(retry.added, 0)
    assert.equal(retry.pruned, 0)
    assert.deepEqual(retry.failures, [])
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
}))

for (const mode of ['wrapped', 'independent'] as const) test(`declared discovery retains ${mode} cancellation failure and releases its snapshot`, async t => {
  const store = open()
  const controller = new AbortController(), reason = new Error('cancel declared fetch')
  const transport = new Error('transport detail')
  const failure = mode === 'wrapped' ? new AggregateError([reason, transport], 'cancel with transport detail', { cause: reason }) : transport
  const snapshots: string[] = []
  try {
    store.ingest('source/a HAS path: https://records.test/a.cave')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const capability = store.adapter.capabilities.backup!
    const write = capability.write.bind(capability)
    t.mock.method(capability, 'write', (db: Parameters<typeof write>[0], destination: string) => {
      snapshots.push(destination)
      return write(db, destination)
    })
    await assert.rejects(Declared.discovery(store, 'root.db', {
      signal: controller.signal,
      fetchImpl: async () => { controller.abort(reason); throw failure }
    }), error => {
      assert.ok(error instanceof AggregateError)
      if (mode === 'wrapped') assert.equal(error, failure)
      assert.deepEqual(error.errors, [reason, transport])
      assert.equal(error.cause, reason)
      return true
    })
    assert.equal(snapshots.length, 1)
    assert.ok(snapshots.every(path => !existsSync(dirname(path))))
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    const retry = await Declared.discovery(store, 'root.db', {
      fetchImpl: async () => new Response('remote IS fetched')
    })
    assert.equal(retry.sequence.length, 1)
    assert.equal(snapshots.length, 2)
    assert.ok(snapshots.every(path => !existsSync(dirname(path))))
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('declared file failures preserve imported data and declaration removal does not retire it', () => {
  withDir(dir => {
    const db = join(dir, 'k.db'), path = join(dir, 'facts.cave')
    writeFileSync(path, 'fact IS old\n')
    const store = open(db)
    try {
      store.ingest('source/facts HAS path: facts.cave\nlocal IS retained')
      assemble(store, db)
      const snapshot = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const before = snapshot()
      const declaration = Declared.recordedDeclaration(store, 'facts')
      rmSync(path)
      assert.throws(() => assemble(store, db), /ENOENT|no such file/)
      assert.equal(snapshot(), before)
      assert.equal(Declared.recordedDeclaration(store, 'facts'), declaration)
      writeFileSync(path, 'broken\n')
      assert.throws(() => assemble(store, db), /does not parse/)
      assert.equal(snapshot(), before)
      assert.equal(Declared.recordedDeclaration(store, 'facts'), declaration)
      writeFileSync(path, 'fact IS old\n')
      assemble(store, db)
      assert.equal(snapshot(), before, 'restoring unchanged source bytes does not duplicate history')
      writeFileSync(path, 'fact IS new\n')
      assemble(store, db)
      const facts = () => store.currentBeliefs().filter(row => row.subject === 'fact' && row.conf > 0).map(row => row.object)
      assert.deepEqual(facts(), ['new'])
      store.ingest('source/facts HAS path: facts.cave @ 0%')
      const removed = snapshot()
      assert.deepEqual(Declared.declaredSources(store), [])
      assert.deepEqual(assemble(store, db), [])
      assert.equal(snapshot(), removed)
      assert.deepEqual(facts(), ['new'], 'removing the declaration is not an imported-data retraction')
      store.ingest('source/facts HAS path: facts.cave')
      const restored = snapshot()
      assemble(store, db)
      assert.equal(snapshot(), restored, 'restoring the same declaration reuses its successful digest')
      assert.deepEqual(facts(), ['new'])
      assert.ok(store.currentBeliefs().some(row => row.subject === 'local' && row.conf > 0))
    } finally { store.close() }
  })
})


test('discovery locates preparation failures, preserves causes and releases its snapshot', async t => {
  const store = open()
  const snapshots: string[] = []
  const unreadable = new Error('unreadable')
  Object.defineProperty(unreadable, 'message', { get() { throw new Error('message unavailable') } })
  try {
    store.ingest('source/records HAS path: https://records.test/data.cave')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const capability = store.adapter.capabilities.backup!
    const write = capability.write.bind(capability)
    t.mock.method(capability, 'write', (db: Parameters<typeof write>[0], destination: string) => {
      snapshots.push(destination)
      return write(db, destination)
    })
    for (const failure of [new Error('load failed'), Object.create(null), unreadable]) {
      await assert.rejects(Declared.discovery(store, 'root.db', { fetchImpl: async () => { throw failure } }), error => {
        assert.ok(error instanceof LocateError)
        assert.match(error.message, /source\/records \(https:\/\/records.test\/data.cave\)/)
        assert.equal(error.cause, failure)
        assert.ok(error.message.endsWith(failure instanceof Error && failure !== unreadable ? 'load failed' : '[unprintable thrown value]'))
        return true
      })
      assert.ok(snapshots.every(path => !existsSync(dirname(path))))
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    const retry = await Declared.discovery(store, 'root.db', { fetchImpl: async () => new Response('remote IS valid') })
    assert.equal(retry.sequence.length, 1)
    assert.ok(snapshots.every(path => !existsSync(dirname(path))))
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('discovery locates application failures and releases its snapshot before retry', async t => {
  const store = open()
  const snapshots: string[] = []
  try {
    store.ingest('source/vocabulary HAS path: https://records.test/vocabulary.cave')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const capability = store.adapter.capabilities.backup!
    const write = capability.write.bind(capability)
    t.mock.method(capability, 'write', (db: Parameters<typeof write>[0], destination: string) => {
      snapshots.push(destination)
      return write(db, destination)
    })
    await assert.rejects(Declared.discovery(store, 'root.db', {
      fetchImpl: async () => new Response('CONTAINS REVERSE ELSEWHERE\n')
    }), error => {
      assert.ok(error instanceof LocateError)
      assert.match(error.message, /source\/vocabulary \(https:\/\/records.test\/vocabulary\.cave\)/)
      assert.ok(error.cause instanceof Error)
      assert.ok(!(error.cause instanceof LocateError), 'source context is added exactly once')
      assert.match(error.cause.message, /prelude failed to ingest/)
      return true
    })
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.ok(snapshots.every(path => !existsSync(dirname(path))))
    const retry = await Declared.discovery(store, 'root.db', {
      fetchImpl: async () => new Response('remote IS valid\n')
    })
    assert.equal(retry.sequence.length, 1)
    assert.equal(snapshots.length, 2)
    assert.ok(snapshots.every(path => !existsSync(dirname(path))))
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})
