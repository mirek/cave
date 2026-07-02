import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addCommand, cave, demoCommand, exportCommand, parseCommand, queryCommand } from '@cave/cli'

const withDir = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-'))
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('help and unknown commands', () => {
  assert.equal(cave([]).code, 0)
  assert.match(cave(['help']).out, /Usage:/)
  const unknown = cave(['frobnicate'])
  assert.equal(unknown.code, 2)
  assert.match(unknown.err, /unknown command/)
})

test('parse lints a file', () => {
  withDir(dir => {
    const file = join(dir, 'good.cave')
    writeFileSync(file, 'jwt IS token-format\nauth USES jwt @ 90%\n')
    const result = parseCommand([file])
    assert.equal(result.code, 0)
    assert.match(result.out, /2 claim/)
  })
})

test('parse reports diagnostics with exit 1', () => {
  withDir(dir => {
    const file = join(dir, 'bad.cave')
    writeFileSync(file, 'a uses b\nc USES d\n')
    const result = parseCommand([file])
    assert.equal(result.code, 1)
    assert.match(result.err, /line 1/)
    assert.match(result.out, /1 claim/)
  })
})

test('parse --json dumps the document', () => {
  withDir(dir => {
    const file = join(dir, 'x.cave')
    writeFileSync(file, 'a USES b\n')
    const result = parseCommand([file, '--json'])
    const document = JSON.parse(result.out)
    assert.equal(document.lines[0].kind, 'claim')
  })
})

test('add → query → export round trip', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      'auth/middleware USES jwt',
      'api/gateway USES jwt',
      'packages/api PART-OF monorepo',
      'auth/middleware HAS bug: token-expiry #security'
    ].join('\n'))
    const added = addCommand([file, '--db', db])
    assert.equal(added.code, 0, added.err)
    assert.match(added.out, /added 4 claim/)

    const users = queryCommand(['?x USES jwt', '--db', db])
    assert.equal(users.code, 0)
    assert.equal(users.out, '?x = auth/middleware\n?x = api/gateway\n')

    const inverse = queryCommand(['monorepo CONTAINS ?x', '--db', db])
    assert.match(inverse.out, /\?x = packages\/api/)

    const json = queryCommand(['?x HAS bug: ?bug #security', '--db', db, '--json'])
    const matches = JSON.parse(json.out)
    assert.deepEqual(matches[0].bindings, { x: 'auth/middleware', bug: 'token-expiry' })

    const exported = exportCommand(['--db', db])
    assert.equal(exported.code, 0)
    assert.match(exported.out, /monorepo CONTAINS packages\/api/)
  })
})

test('query with WHERE filter as second positional', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, 'memory-leak CAUSE app/crash @ 50%\ndeadlock CAUSE app/crash @ 30%\n')
    addCommand([file, '--db', db])
    const filtered = queryCommand(['?cause CAUSE app/crash', 'WHERE conf >= 0.4', '--db', db])
    assert.equal(filtered.out, '?cause = memory-leak\n')
  })
})

test('bound patterns with no variables print matched raw lines', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, 'auth USES jwt\n')
    addCommand([file, '--db', db])
    const bound = queryCommand(['auth USES jwt', '--db', db])
    assert.equal(bound.out, 'auth USES jwt\n')
    assert.equal(queryCommand(['auth USES sessions', '--db', db]).out, 'no matches\n')
  })
})

test('add --strict fails on problems and leaves the db empty', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'bad.cave')
    writeFileSync(file, 'a uses b\n')
    const result = addCommand([file, '--db', db, '--strict'])
    assert.equal(result.code, 1)
    const exported = exportCommand(['--db', db])
    assert.equal(exported.out, '')
  })
})

test('missing --db is a usage error', () => {
  assert.equal(addCommand(['x.cave']).code, 1)
  assert.equal(queryCommand(['?x USES y']).code, 1)
  assert.equal(exportCommand([]).code, 1)
})

test('demo narrates the multi-hop recovery', () => {
  const result = demoCommand()
  assert.equal(result.code, 0)
  assert.match(result.out, /reconstructed claims:/)
  assert.match(result.out, /FIX token-expiry/)
})

test('fully-bound transitive query confirms the match instead of crashing', () => {
  withDir(dir => {
    const db = join(dir, 'tr.db')
    const file = join(dir, 'tr.cave')
    writeFileSync(file, 'terrier EXTENDS dog\ndog EXTENDS animal\n')
    addCommand([file, '--db', db])
    const result = queryCommand(['terrier EXTENDS+ animal', '--db', db])
    assert.equal(result.code, 0, result.err)
    assert.equal(result.out, 'terrier EXTENDS+ animal\n')
    assert.equal(queryCommand(['animal EXTENDS+ terrier', '--db', db]).out, 'no matches\n')
  })
})

test('query/export accept --no-prelude so read-time registry matches write-time', () => {
  withDir(dir => {
    const db = join(dir, 'np.db')
    const file = join(dir, 'np.cave')
    writeFileSync(file, 'packages/api PART-OF monorepo\n')
    addCommand([file, '--db', db, '--no-prelude'])
    const withPrelude = queryCommand(['packages/api PART-OF ?x', '--db', db])
    assert.equal(withPrelude.out, 'no matches\n', 'prelude registry flips the verb away from the stored row')
    const aligned = queryCommand(['packages/api PART-OF ?x', '--db', db, '--no-prelude'])
    assert.equal(aligned.out, '?x = monorepo\n')
    const exported = exportCommand(['--db', db, '--no-prelude'])
    assert.match(exported.out, /packages\/api PART-OF monorepo/)
  })
})
