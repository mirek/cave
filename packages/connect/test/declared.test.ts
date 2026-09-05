import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocateError, open, openAt } from '@cavelang/store'
import { Declared, assemble, declaredNaming } from '@cavelang/connect'

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
    assert.equal(Declared.isCave({ name: 'verbs', path: 'verbs.cave' }), true)
    assert.equal(Declared.isCave({ name: 'x', path: 'x.txt', format: 'cave' }), true)
    assert.equal(Declared.isCave({ name: 'people', path: 'people.csv' }), false)
  } finally {
    store.close()
  }
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
      assert.deepEqual(ready.map(entry => [entry.declared.name, entry.declared.path]), [['b', 'new.cave'], ['people', 'people.csv'], ['z', 'z.cave']], 'declared order, b re-prepared in place with the nested path')
      Declared.run(store, Declared.prepareSync({ name: 'people', path: 'people.csv', map: 'people.map.cave', key: 'id' }, dir))
      assert.equal(Declared.followed(store, 'people'), true, 'record digests count — the mapping has no prelude')
      assert.equal(Declared.followed(store, 'b'), false)
      const left = await Declared.discover(store, db, { skipFollowed: true })
      assert.deepEqual(left.map(entry => entry.declared.name), ['b', 'z'])
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
      assert.equal(ready.find(entry => entry.declared.name === 'people')?.declared.map, 'as-staff.map.cave', 'the delta is applied over the known declaration')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
