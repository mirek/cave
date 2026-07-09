import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Suite } from '@cavelang/eval'

const withDir = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-eval-suite-'))
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a case is its golden plus the single dot-free-extension sibling', () =>
  withDir(dir => {
    writeFileSync(join(dir, 'notes.md'), 'source')
    writeFileSync(join(dir, 'notes.golden.cave'), 'a IS b')
    writeFileSync(join(dir, 'notes.queries.cave'), '?x IS b')
    const suite = Suite.discover([dir], { cwd: dir })
    assert.deepEqual(suite.problems, [])
    assert.equal(suite.cases.length, 1)
    const [kase] = suite.cases
    assert.equal(kase!.name, 'notes')
    assert.equal(basename(kase!.source), 'notes.md')
    assert.equal(basename(kase!.queries!), 'notes.queries.cave')
    assert.equal(kase!.instructions, undefined)
  }))

test('missing and ambiguous sources are problems, not guesses', () =>
  withDir(dir => {
    writeFileSync(join(dir, 'orphan.golden.cave'), 'a IS b')
    writeFileSync(join(dir, 'twins.golden.cave'), 'a IS b')
    writeFileSync(join(dir, 'twins.md'), 'one')
    writeFileSync(join(dir, 'twins.txt'), 'two')
    const suite = Suite.discover([dir], { cwd: dir })
    assert.equal(suite.cases.length, 0)
    assert.equal(suite.problems.length, 2)
    assert.match(suite.problems.find(problem => problem.startsWith('orphan'))!, /no source file/)
    assert.match(suite.problems.find(problem => problem.startsWith('twins'))!, /ambiguous source.*twins\.md, twins\.txt/)
  }))

test('sibling cases and eval files never masquerade as sources', () =>
  withDir(dir => {
    // `notes.extra.md` belongs to the `notes.extra` case — the shorter
    // `notes` stem must not claim it.
    writeFileSync(join(dir, 'notes.md'), 'source')
    writeFileSync(join(dir, 'notes.golden.cave'), 'a IS b')
    writeFileSync(join(dir, 'notes.instructions.md'), 'steer')
    writeFileSync(join(dir, 'notes.extra.md'), 'other source')
    writeFileSync(join(dir, 'notes.extra.golden.cave'), 'c IS d')
    const suite = Suite.discover([dir], { cwd: dir })
    assert.deepEqual(suite.problems, [])
    assert.deepEqual(suite.cases.map(kase => [kase.name, basename(kase.source)]), [
      ['notes', 'notes.md'],
      ['notes.extra', 'notes.extra.md']
    ])
    assert.equal(basename(suite.cases[0]!.instructions!), 'notes.instructions.md')
  }))

test('dotted stems pair with their dotted source', () =>
  withDir(dir => {
    writeFileSync(join(dir, 'design.notes.md'), 'source')
    writeFileSync(join(dir, 'design.notes.golden.cave'), 'a IS b')
    const suite = Suite.discover([dir], { cwd: dir })
    assert.deepEqual(suite.problems, [])
    assert.equal(suite.cases[0]!.name, 'design.notes')
    assert.equal(basename(suite.cases[0]!.source), 'design.notes.md')
  }))

test('instructions resolve nearest-first: case, directory, suite root, explicit', () =>
  withDir(dir => {
    mkdirSync(join(dir, 'nested'))
    writeFileSync(join(dir, 'instructions.md'), 'root')
    writeFileSync(join(dir, 'nested', 'a.md'), 'source')
    writeFileSync(join(dir, 'nested', 'a.golden.cave'), 'a IS b')
    writeFileSync(join(dir, 'nested', 'b.md'), 'source')
    writeFileSync(join(dir, 'nested', 'b.golden.cave'), 'a IS b')
    writeFileSync(join(dir, 'nested', 'b.instructions.md'), 'case')
    const suite = Suite.discover([dir], { cwd: dir })
    assert.equal(suite.cases.length, 2)
    const byName = new Map(suite.cases.map(kase => [basename(kase.name), kase]))
    assert.equal(byName.get('a')!.instructions, join(dir, 'instructions.md'), 'falls through to the suite root')
    assert.equal(byName.get('b')!.instructions, join(dir, 'nested', 'b.instructions.md'))

    writeFileSync(join(dir, 'nested', 'instructions.md'), 'dir')
    const nearer = Suite.discover([dir], { cwd: dir })
    assert.equal(new Map(nearer.cases.map(kase => [basename(kase.name), kase])).get('a')!.instructions,
      join(dir, 'nested', 'instructions.md'), 'the case directory beats the suite root')

    const explicit = Suite.discover([dir], { cwd: dir, instructions: join(dir, 'instructions.md') })
    assert.ok(explicit.cases.every(kase => kase.instructions === join(dir, 'instructions.md')))
  }))

test('a golden file is accepted as a single-case root; junk roots are problems', () =>
  withDir(dir => {
    writeFileSync(join(dir, 'one.md'), 'source')
    writeFileSync(join(dir, 'one.golden.cave'), 'a IS b')
    const single = Suite.discover([join(dir, 'one.golden.cave')], { cwd: dir })
    assert.deepEqual(single.problems, [])
    assert.equal(single.cases.length, 1)

    const missing = Suite.discover([join(dir, 'nope')], { cwd: dir })
    assert.match(missing.problems[0]!, /no such file or directory/)
    const notGolden = Suite.discover([join(dir, 'one.md')], { cwd: dir })
    assert.match(notGolden.problems[0]!, /not a suite directory/)
    mkdirSync(join(dir, 'empty'))
    const empty = Suite.discover([join(dir, 'empty')], { cwd: dir })
    assert.match(empty.problems[0]!, /no \.golden\.cave cases found/)
  }))
