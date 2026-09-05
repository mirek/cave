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
