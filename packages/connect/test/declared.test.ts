import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

test('a failed snapshot leaves no temporary directory behind', async () => {
  const store = open()
  try {
    store.ingest('source/x HAS path: x.cave')
    const leftovers = (): number => readdirSync(tmpdir()).filter(name => name.startsWith('cave-discover-')).length
    const before = leftovers()
    const failing = new Proxy(store, {
      get: (target, key, receiver) => key === 'adapter' ?
        { ...target.adapter, capabilities: { ...target.adapter.capabilities, backup: { ...target.adapter.capabilities.backup!, write: () => { throw new Error('disk full') } } } } :
        Reflect.get(target, key, receiver)
    })
    await assert.rejects(Declared.discover(failing, ':memory:'), /disk full/)
    assert.equal(leftovers(), before, 'the snapshot directory was removed')
  } finally {
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
