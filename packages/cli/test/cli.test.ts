import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { actCommand, addCommand, backupCommand, cave, checkCommand, commandHelp, demoCommand, deriveCommand, diagnose, doctorCommand, exportCommand, generateCommand, highlightCommand, importCommand, parseCommand, queryCommand, querySourcesCommand, reconstructCommand, reportCommand, resolveCommand, restoreCommand, searchCommand, suggestAliasCommand, syncCommand } from '@cavelang/cli'
import { open, Schema } from '@cavelang/store'

const withDir = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-'))
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('resolve percentages distinguish positive reliability from zero and near-one from certainty', () => {
  withDir(dir => {
    const db = join(dir, 'reliability.db')
    const store = open(db)
    try {
      store.ingest('api IS healthy @src:probe\napi IS NOT healthy @src:other')
      for (const [value, expected] of [
        [0, '0%'], [Number.MIN_VALUE, '<0.1%'], [0.00001, '<0.1%'],
        [0.001, '0.1%'], [0.999, '99.9%'], [0.99999, '>99.9%'], [1, '100%']
      ] as const) {
        const literal = value === Number.MIN_VALUE ? `0.${'0'.repeat(323)}5` : String(value)
        store.ingest(`source/probe HAS reliability: ${literal}`)
        const policy = resolveCommand(['--db', db, '--policy', '--no-prelude'])
        assert.equal(policy.code, 0, policy.err)
        assert.ok(policy.out.split('\n').some(line => line.startsWith('source/probe ') && line.endsWith(`reliability ${expected}`)), expected)
        const contested = resolveCommand(['--db', db, '--no-prelude'])
        assert.equal(contested.code, 0, contested.err)
        assert.ok(contested.out.split('\n').some(line => line.includes('api IS healthy ') && line.endsWith(`effective ${expected}`)), expected)
        const json = resolveCommand(['--db', db, '--policy', '--json', '--no-prelude'])
        assert.equal(JSON.parse(json.out).find((entry: { prefix: string }) => entry.prefix === 'probe').reliability, value)
      }
    } finally { store.close() }
  })
})

test('derive retains notes for large duplicate declaration sets', () => {
  withDir(dir => {
    const db = join(dir, 'duplicate-rules.db')
    const size = 130_000
    const store = open(db)
    try {
      store.ingest(Array.from({ length: size + 1 }, (_, i) =>
        'rule/copy-' + i + ' HAS rule: `?x IS service => ?x IS monitored`').join('\n'))
    } finally { store.close() }
    const result = deriveCommand(['--db', db, '--no-prelude'])
    assert.equal(result.code, 0, result.err)
    assert.equal(result.err, '')
    const notes = result.out.split('\n').filter(line => line.startsWith('note: '))
    assert.equal(notes.length, size)
    for (let i = 0; i < size; i++) {
      assert.equal(notes[i], `note: rule/copy-${i + 1} duplicates rule/copy-0 — one rule, first declaration fires`)
    }
  })
})

test('resolve renders large policy tables with complete aligned rows', () => {
  withDir(dir => {
    const db = join(dir, 'policy.db')
    const size = 130_000
    const store = open(db)
    try {
      store.ingest(Array.from({ length: size }, (_, i) => `source/import-${i} HAS precedence: 5`).join('\n'))
    } finally { store.close() }
    const result = resolveCommand(['--db', db, '--policy', '--no-prelude'])
    assert.equal(result.code, 0, result.err)
    assert.equal(result.err, '')
    const rows = result.out.trimEnd().split('\n')
    assert.equal(rows.length, size + 5)
    const declarations = rows.filter(line => line.startsWith('source/import-'))
    assert.equal(declarations.length, size)
    const width = 'source/import-129999'.length
    const seen = new Set<string>()
    for (const row of declarations) {
      assert.equal(row.slice(width), '  precedence 5')
      seen.add(row.slice(0, width).trimEnd())
    }
    for (let i = 0; i < size; i++) assert.ok(seen.has(`source/import-${i}`))
  })
})

test('check formats every review candidate in a large advisory report', () => {
  withDir(dir => {
    const db = join(dir, 'review.db')
    const size = 130_000
    const source = Array.from({ length: size }, (_, i) => `review-${i} EXISTS @ 50%`)
    const store = open(db)
    try { store.ingest(source.join('\n')) } finally { store.close() }
    const result = checkCommand(['--db', db, '--no-prelude'])
    assert.equal(result.code, 0, result.err)
    assert.equal(result.err, '')
    assert.ok(result.out.includes(`review candidates (${size}, conf 0.3-0.7):`))
    const rows = result.out.split('\n').filter(line => line.startsWith('  '))
    assert.equal(rows.length, size)
    assert.deepEqual(new Set(rows), new Set(source.map(line => `  ${line}`)))
  })
})

test('derive returns every large-prelude diagnostic without a formatting failure', () => {
  withDir(dir => {
    const db = join(dir, 'declarations.db')
    const file = join(dir, 'rules.cave')
    const size = 130_000
    writeFileSync(file, Array.from({ length: size }, () => 'broken').join('\n'))
    const result = deriveCommand(['--db', db, file])
    assert.equal(result.code, 1)
    const lines = result.err.trimEnd().split('\n')
    assert.equal(lines.length, size)
    for (let i = 0; i < size; i++) assert.ok(lines[i]!.startsWith(`rules line ${i + 1}: `))
    assert.doesNotMatch(result.err, /Maximum call stack/)
  })
})

test('query JSON and text preserve prototype-named variables', () => {
  withDir(dir => {
    const db = join(dir, 'query.db')
    const store = open(db)
    try { store.ingest('api IS service') } finally { store.close() }
    const json = queryCommand(['--db', db, '?__proto__ IS service', '--json'])
    assert.equal(json.code, 0, json.err)
    assert.deepEqual(JSON.parse(json.out).matches[0].bindings, { ['__proto__']: 'api' })
    const text = queryCommand(['--db', db, '?__proto__ IS service'])
    assert.equal(text.code, 0, text.err)
    assert.match(text.out, /\?__proto__ = api/)
  })
})

for (const json of [false, true]) test(`derive keeps reporting malformed file errors on retry (${json ? 'JSON' : 'text'})`, () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'rules.cave')
    for (const text of ['api IS service\nbroken', '?x IS service => ?unbound IS watched']) {
      writeFileSync(file, text)
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = deriveCommand([file, '--db', db, ...(json ? ['--json'] : [])])
        assert.equal(result.code, 1)
        assert.match(result.err, /rules line/)
      }
    }
  })
})

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
    const page = JSON.parse(json.out)
    assert.equal(page.format, 'cave.query-page')
    assert.equal(page.version, 1)
    assert.deepEqual(page.matches[0].bindings, { x: 'auth/middleware', bug: 'token-expiry' })
    assert.equal(page.matches[0].format, 'cave.query-match')
    assert.equal(page.matches[0].version, 1)
    assert.equal(page.matches[0].claim.format, 'cave.claim')
    assert.doesNotMatch(json.out, /claim_key|raw_line|value_text/)

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

test('query rejects invalid requests on empty stores and empty historical snapshots', () => {
  withDir(dir => {
    const db = join(dir, 'empty.db')
    const store = open(db)
    store.close()
    for (const json of [[], ['--json']]) {
      for (const args of [['this is not a query'], ['?x USES jwt', '--at', 'not-a-time']]) {
        const result = queryCommand(['--db', db, ...args, ...json])
        assert.equal(result.code, 1)
        assert.match(result.err, /CAVE-Q/)
      }
    }
    const writer = open(db)
    writer.ingest('api USES jwt')
    writer.close()
    assert.equal(queryCommand(['--db', db, '?x USES jwt', '--at', 'not-a-time', '--as-of', '2000-01-01']).code, 1)
  })
})

test('query cursors reject older rows and lineage arriving through text and database sync', () => {
  for (const kind of ['text', 'database']) withDir(dir => {
    const origin = join(dir, 'origin.db'), target = join(dir, 'target.db'), text = join(dir, 'origin.cave')
    const source = open(origin)
    source.ingest('offline USES jwt')
    writeFileSync(text, source.exportText({ tx: true }))
    source.close()
    const local = open(target)
    local.ingest('a USES jwt\nb USES jwt')
    local.close()
    const args = ['--db', target, '?x USES jwt', '--limit', '1']
    const first = JSON.parse(queryCommand([...args, '--json']).out)
    assert.equal(first.matches[0].bindings.x, 'a')
    assert.equal(syncCommand(['--db', target, kind === 'text' ? text : origin, '--no-record']).code, 0)
    for (const json of [[], ['--json']]) {
      const stale = queryCommand([...args, '--cursor', first.next, ...json])
      assert.equal(stale.code, 1)
      assert.match(stale.err, /snapshot changed.*restart/i)
      assert.equal(stale.out, '')
    }
    const restarted = JSON.parse(queryCommand([...args, '--json']).out)
    assert.equal(restarted.matches[0].bindings.x, 'offline')
    assert.equal(syncCommand(['--db', origin, target, '--no-record']).code, 0)
    const peer = open(origin)
    const rows = peer.currentBeliefs()
    peer.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)')
      .run(rows[1]!.id, 'BECAUSE', rows[0]!.id)
    writeFileSync(text, peer.exportText({ tx: true }))
    peer.close()
    assert.equal(syncCommand(['--db', target, kind === 'text' ? text : origin, '--no-record']).code, 0)
    const changedEdges = queryCommand([...args, '--cursor', restarted.next, '--json'])
    assert.equal(changedEdges.code, 1)
    assert.match(changedEdges.err, /snapshot changed.*restart/i)
  })
})

test('query defaults to a bounded page and continues the frozen snapshot', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'many.cave')
    writeFileSync(file, Array.from({ length: 102 }, (_, index) =>
      `service/${index.toString().padStart(3, '0')} USES jwt`).join('\n'))
    assert.equal(addCommand([file, '--db', db]).code, 0)

    const first = JSON.parse(queryCommand(['?service USES jwt', '--db', db, '--json']).out)
    assert.equal(first.matches.length, 100)
    assert.equal(typeof first.next, 'string')

    const later = join(dir, 'later.cave')
    writeFileSync(later, 'service/later USES jwt')
    assert.equal(addCommand([later, '--db', db]).code, 0)
    const second = JSON.parse(queryCommand([
      '?service USES jwt', '--db', db, '--json', '--cursor', first.next
    ]).out)
    assert.deepEqual(second.matches.map((match: { bindings: { service: string } }) => match.bindings.service),
      ['service/100', 'service/101'])
    assert.equal(second.next, undefined)
  })
})

test('query --aliases resolves entities through current ALIAS claims (spec §13.6)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      'postgres ALIAS postgresql',
      'billing USES postgres',
      'analytics USES postgresql'
    ].join('\n'))
    addCommand([file, '--db', db])
    assert.equal(queryCommand(['?x USES postgres', '--db', db]).out, '?x = billing\n')
    const widened = queryCommand(['?x USES postgres', '--db', db, '--aliases'])
    assert.equal(widened.out, '?x = billing\n?x = analytics\n')
  })
})

test('query --as-of resolves beliefs at a past tx (spec §12.3)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const first = join(dir, 'first.cave')
    writeFileSync(first, 'server IS compromised @ 60%\n')
    addCommand([first, '--db', db])
    const store = open(db)
    const boundary = store.claimsAbout('server')[0]!.tx
    store.close()
    const retraction = join(dir, 'retraction.cave')
    writeFileSync(retraction, 'server IS compromised @ 0% ; clean scan\n')
    addCommand([retraction, '--db', db])
    assert.equal(queryCommand(['server IS compromised', '--db', db]).out, 'no matches\n')
    const then = queryCommand(['server IS compromised', '--db', db, '--as-of', boundary])
    assert.equal(then.code, 0)
    assert.match(then.out, /server IS compromised/)
    const invalid = queryCommand(['server IS compromised', '--db', db, '--as-of', 'yesterday'])
    assert.equal(invalid.code, 1)
    assert.match(invalid.err, /as-of boundary/)
  })
})

test('query --at anchors in valid time and interpolates trajectories (spec §32.4)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      'revenue IS 20B -> 40B USD/yr @2025..2028',
      'alice WORKS-AT acme @2020..2023',
      'alice WORKS-AT initech @2024..'
    ].join('\n'))
    addCommand([file, '--db', db])
    // 2026-07-02T12:00Z is the exact midpoint of 2025-01-01..2028-01-01.
    const mid = queryCommand(['revenue IS', '--db', db, '--at', '2026-07-02T12:00:00Z'])
    assert.equal(mid.code, 0)
    assert.match(mid.out, /revenue IS 20B -> 40B USD\/yr @2025\.\.2028 ; at 2026-07-02T12:00:00Z: 30B USD\/yr/)
    assert.equal(queryCommand(['revenue IS', '--db', db, '--at', '2024']).out, 'no matches\n')
    assert.equal(queryCommand(['alice WORKS-AT ?org', '--db', db, '--at', '2021']).out, '?org = acme\n')
    assert.equal(queryCommand(['alice WORKS-AT ?org', '--db', db, '--at', '2026']).out, '?org = initech\n')
    const invalid = queryCommand(['revenue IS', '--db', db, '--at', 'someday'])
    assert.equal(invalid.code, 1)
    assert.match(invalid.err, /at anchor/)
  })
})

test('query --resolve matches winners only — a cli correction survives the re-run (spec §26.4)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const ingested = join(dir, 'ingested.cave')
    writeFileSync(ingested, 'service HAS owner: alice @src:ingest/93a0\n')
    const correction = join(dir, 'correction.cave')
    writeFileSync(correction, 'service HAS owner: bob\n') // stamped @src:cli
    addCommand([ingested, '--db', db])
    addCommand([correction, '--db', db])
    addCommand([ingested, '--db', db]) // the re-run — newest tx, machine tier
    const plain = queryCommand(['service HAS owner: ?who', '--db', db])
    assert.deepEqual(plain.out.trim().split('\n').sort(), ['?who = alice', '?who = bob'])
    const resolved = queryCommand(['service HAS owner: ?who', '--db', db, '--resolve'])
    assert.equal(resolved.out, '?who = bob\n')
    const conflict = queryCommand(['?x IS ?y', '--db', db, '--resolve', '--all'])
    assert.equal(conflict.code, 1)
    assert.match(conflict.err, /incompatible with all/)
  })
})

test('resolve lists contested facts winner-first, and the effective policy (spec §26.4)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      'service HAS owner: alice @src:ingest/93a0',
      'service HAS owner: bob',
      'lonely IS fact'
    ].join('\n'))
    addCommand([file, '--db', db])
    const report = resolveCommand(['--db', db])
    assert.equal(report.code, 0)
    const [winner, loser, ...more] = report.out.trim().split('\n')
    assert.match(winner!, /^service HAS owner: bob ; class 4, effective 100%$/)
    assert.match(loser!, /^ {2}over service HAS owner: alice @src:ingest\/93a0 ; class 2, effective 100%$/)
    assert.deepEqual(more, [], 'uncontested facts are not listed')
    const policy = resolveCommand(['--db', db, '--policy'])
    assert.match(policy.out, /source\/cli\s+precedence 4/)
    assert.match(policy.out, /^source\s+precedence 2/m)
    const json = resolveCommand(['--db', db, '--json'])
    assert.doesNotMatch(json.out, /claim_key|raw_line|value_text|res_rank/)
    const ranked = JSON.parse(json.out)[0].rows[0]
    assert.equal(ranked.format, 'cave.claim')
    assert.equal(ranked.resolution.rank, 1)
    const empty = join(dir, 'empty.db')
    open(empty).close()
    assert.equal(resolveCommand(['--db', empty]).out, 'no contested facts\n')
  })
})

test('query bindings carry the matched claim comment; raw lines already do', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      'auth USES jwt ; json web tokens rotated weekly',
      'billing USES jwt',
      'api HAS owner: alice #security ; confirmed by heap-dump review'
    ].join('\n'))
    addCommand([file, '--db', db])
    const users = queryCommand(['?x USES jwt', '--db', db])
    assert.equal(users.out, '?x = auth  ; json web tokens rotated weekly\n?x = billing\n')
    const owner = queryCommand(['api HAS owner: ?who', '--db', db])
    assert.equal(owner.out, '?who = alice  ; confirmed by heap-dump review\n')
    const bound = queryCommand(['auth USES jwt', '--db', db])
    assert.equal(bound.out, 'auth USES jwt ; json web tokens rotated weekly\n')
    const json = JSON.parse(queryCommand(['?x USES jwt', '--db', db, '--json']).out)
    assert.equal(json.matches[0].claim.claim.comment, 'json web tokens rotated weekly')
  })
})

test('a comment block above a claim is stored, queried, and printed as one multi-line comment (spec §6.4)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      '; the auth notes, a file header kept out of the store',
      '',
      '; json web tokens',
      '; rotated weekly',
      'auth USES jwt ; confirmed by ops',
      'billing USES jwt'
    ].join('\n'))
    assert.equal(addCommand([file, '--db', db]).code, 0)
    const users = queryCommand(['?x USES jwt', '--db', db])
    assert.equal(users.out, '; json web tokens\n; rotated weekly\n?x = auth  ; confirmed by ops\n?x = billing\n')
    const bound = queryCommand(['auth USES jwt', '--db', db])
    assert.equal(bound.out, '; json web tokens\n; rotated weekly\nauth USES jwt ; confirmed by ops\n', 'the raw line carries its block')
    const json = JSON.parse(queryCommand(['?x USES jwt', '--db', db, '--json']).out)
    assert.equal(json.matches[0].claim.claim.comment, 'json web tokens\nrotated weekly\nconfirmed by ops')
    const exported = exportCommand(['--db', db]).out
    assert.match(exported, /^; json web tokens\n; rotated weekly\nauth USES jwt @src:cli ; confirmed by ops\n/m, 'export opens the block above the claim')
    assert.deepEqual(searchCommand(['rotated', '--db', db]).out.trimEnd().split('\n'), ['; json web tokens', '; rotated weekly', 'auth USES jwt ; confirmed by ops'])
  })
})

test('search: FTS5 over comments, attribute names, values, tags, contexts and inverse spellings', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      'auth USES jwt ; json web tokens rotated weekly',
      'api HAS owner: alice #security:high ; owner confirmed by heap-dump review',
      'cache IS warm @production',
      'jwt USED-BY billing'
    ].join('\n'))
    addCommand([file, '--db', db])
    const lines = (argv: string[]): string[] => {
      const result = searchCommand([...argv, '--db', db])
      assert.equal(result.code, 0, result.err)
      return result.out.trimEnd().split('\n')
    }
    assert.deepEqual(lines(['heap dump']), ['api HAS owner: alice #security:high ; owner confirmed by heap-dump review'], 'comment, tokenized across the hyphen')
    assert.deepEqual(lines(['rotated', 'weekly']), ['auth USES jwt ; json web tokens rotated weekly'], 'positionals join into one phrase')
    assert.deepEqual(lines(['owner']), ['api HAS owner: alice #security:high ; owner confirmed by heap-dump review'], 'attribute name')
    assert.deepEqual(lines(['alice']), ['api HAS owner: alice #security:high ; owner confirmed by heap-dump review'], 'attribute value')
    assert.deepEqual(lines(['security']), ['api HAS owner: alice #security:high ; owner confirmed by heap-dump review'], 'tag via the raw line')
    assert.deepEqual(lines(['production']), ['cache IS warm @production'], 'context via the raw line')
    assert.deepEqual(lines(['billing']), ['jwt USED-BY billing'], 'canonical subject of an inverse-spelled line')
    assert.deepEqual(lines(['jwt']), ['jwt USED-BY billing', 'auth USES jwt ; json web tokens rotated weekly'], 'newest first, comments included')
    assert.deepEqual(lines(['token-expiry']), ['no matches'], 'hyphenated terms are literal phrases, not column filters')
    assert.deepEqual(lines(['--raw', 'comment:heap AND subject:api']), ['api HAS owner: alice #security:high ; owner confirmed by heap-dump review'], 'raw MATCH syntax')
    assert.deepEqual(lines(['jwt', '--limit', '1']), ['jwt USED-BY billing', 'more matches beyond 1; raise --limit'])

    const json = JSON.parse(searchCommand(['rotated weekly', '--db', db, '--json']).out)
    assert.equal(json.format, 'cave.search')
    assert.equal(json.version, 1)
    assert.equal(json.query, 'rotated weekly')
    assert.equal(json.raw, false)
    assert.equal(json.truncated, false)
    assert.equal(json.matches.length, 1)
    assert.equal(json.matches[0].format, 'cave.claim')
    assert.equal(json.matches[0].claim.comment, 'json web tokens rotated weekly')
    assert.equal(JSON.parse(searchCommand(['jwt', '--db', db, '--json', '--limit', '1']).out).truncated, true)

    const missing = searchCommand(['--db', db])
    assert.equal(missing.code, 1)
    assert.match(missing.err, /search terms are required/)
    const badLimit = searchCommand(['jwt', '--db', db, '--limit', '0'])
    assert.equal(badLimit.code, 1)
    assert.match(badLimit.err, /--limit must be an integer from 1 to 1000/)
    assert.match(cave(['search', '--help']).out, /FTS5 MATCH syntax/)
    assert.match(cave(['help', 'search']).out, /cave search/)
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

test('derive: declare + fire + list + retract (spec §24)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const facts = join(dir, 'facts.cave')
    writeFileSync(facts, 'a NEEDS b @ 80%\nb NEEDS c @ 90%\n')
    addCommand([facts, '--db', db])
    const rules = join(dir, 'rules.cave')
    writeFileSync(rules, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z ; transitive needs\n')

    const first = deriveCommand([rules, '--db', db])
    assert.equal(first.code, 0, first.err)
    assert.match(first.out, /declared 1 rule/)
    assert.match(first.out, /\+1 appended/)
    assert.equal(queryCommand(['a NEEDS c', '--db', db]).out, 'a NEEDS c @ 72.00000000000001%\n')

    // No positional fires the stored rules; nothing new → watermark skip.
    const again = deriveCommand(['--db', db])
    assert.equal(again.code, 0)
    assert.match(again.out, /unchanged premises, skipped/)

    const listed = deriveCommand(['--db', db, '--list'])
    assert.match(listed.out, /rule\/[0-9a-f]{12} `\?x NEEDS \?y, \?y NEEDS \?z => \?x NEEDS \?z` ; transitive needs/)

    const digest = /rule\/([0-9a-f]{12})/.exec(listed.out)![1]!
    const retracted = deriveCommand(['--db', db, '--retract', digest])
    assert.equal(retracted.code, 0)
    assert.match(retracted.out, /1 derived claim/)
    assert.equal(queryCommand(['a NEEDS c', '--db', db]).out, 'no matches\n')
    assert.equal(deriveCommand(['--db', db, '--list']).out, 'no rules\n')
  })
})

test('derive --dry-run reports without writing; problems set the exit code', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const facts = join(dir, 'facts.cave')
    writeFileSync(facts, 'a NEEDS b\nb NEEDS c\n')
    addCommand([facts, '--db', db])
    const rules = join(dir, 'rules.cave')
    writeFileSync(rules, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z\n')

    const dry = deriveCommand([rules, '--db', db, '--dry-run', '--json'])
    assert.equal(dry.code, 0)
    assert.equal(JSON.parse(dry.out).appended, 1)
    assert.equal(queryCommand(['a NEEDS c', '--db', db]).out, 'no matches\n', 'dry run persisted nothing')
    assert.equal(deriveCommand(['--db', db, '--list']).out, 'no rules\n', 'not even the declaration')

    const bad = join(dir, 'bad.cave')
    writeFileSync(bad, '?x NEEDS ?y => ?x NEEDS ?unbound\n?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z\n')
    const rejected = deriveCommand([bad, '--db', db])
    assert.equal(rejected.code, 1, 'declaration errors fail the command even when valid rules still fire')
    assert.match(rejected.err, /\?unbound is not bound/)
    assert.match(queryCommand(['a NEEDS c', '--db', db]).out, /a NEEDS c/)

    assert.equal(deriveCommand(['--db', db, '--min-conf', 'high']).code, 1)
    assert.equal(deriveCommand(['--db', db, '--retract', 'nonexistent']).code, 1)
  })
})

test('derive rejects invalid pass limits before creating its database', () => {
  withDir(dir => {
    const db = join(dir, 'absent.db')
    for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992']) {
      const result = deriveCommand(['--db', db, `--max-passes=${value}`])
      assert.equal(result.code, 1)
      assert.equal(result.out, '')
      assert.match(result.err, /positive safe integer/)
      assert.equal(existsSync(db), false)
    }
  })
})

test('derive pass exhaustion is a resumable non-zero status', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const facts = join(dir, 'facts.cave')
    writeFileSync(facts, 'a NEEDS b\nb NEEDS c\nc NEEDS d\nd NEEDS e\n')
    addCommand([facts, '--db', db])
    const rules = join(dir, 'rules.cave')
    writeFileSync(rules, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z\n')

    const truncated = deriveCommand([rules, '--db', db, '--max-passes', '1', '--json'])
    assert.equal(truncated.code, 1)
    assert.equal(JSON.parse(truncated.out).complete, false)
    const resumed = deriveCommand(['--db', db, '--json'])
    assert.equal(resumed.code, 0)
    assert.equal(JSON.parse(resumed.out).complete, true)
    assert.equal(queryCommand(['a NEEDS e', '--db', db]).code, 0)
  })
})

test('derive pass exhaustion preserves unsupported history until a complete retry', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const facts = join(dir, 'facts.cave'), rules = join(dir, 'rules.cave')
    writeFileSync(facts, 'a IS ready\n')
    assert.equal(addCommand([facts, '--db', db]).code, 0)
    writeFileSync(rules, '?x IS ready => ?x IS enabled\n')
    assert.equal(deriveCommand([rules, '--db', db]).code, 0)
    writeFileSync(facts, 'a IS ready @ 0%\n')
    assert.equal(addCommand([facts, '--db', db]).code, 0)
    const before = exportCommand(['--db', db, '--tx']).out
    for (const json of [false, true]) for (const flags of [[], ['--dry-run']]) {
      const stopped = deriveCommand(['--db', db, '--max-passes', '1', ...(json ? ['--json'] : []), ...flags])
      assert.equal(stopped.code, 1)
      if (json) {
        const report = JSON.parse(stopped.out)
        assert.equal(report.complete, false)
        assert.equal(report.retracted, 0)
      } else {
        assert.match(stopped.out, /note: stopped at 1 passes.*re-run to continue/)
        const summary = stopped.out.trimEnd().split('\n').at(-1)!
        assert.match(summary, /^derived \(incomplete\)/)
        assert.equal(summary.includes('(dry run)'), flags.length > 0)
        assert.match(summary, /0 retracted/)
      }
      assert.equal(exportCommand(['--db', db, '--tx']).out, before)
      assert.match(queryCommand(['a IS enabled', '--db', db]).out, /a IS enabled/)
    }
    const retry = deriveCommand(['--db', db, '--json'])
    assert.equal(retry.code, 0)
    assert.equal(JSON.parse(retry.out).retracted, 1)
    assert.equal(queryCommand(['a IS enabled', '--db', db]).out, 'no matches\n')
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

test('every command answers --help with usage; cave help <command> matches', () => {
  for (const name of Object.keys(commandHelp)) {
    const result = cave([name, '--help'])
    assert.equal(result.code, 0, name)
    assert.match(result.out, /Usage:/, name)
    assert.equal(cave(['help', name]).out, result.out, name)
  }
  assert.match(cave(['query', '--help']).out, /Examples:/)
  assert.match(cave(['q', '-h']).out, /cave query/)
  assert.match(cave(['help', 'help']).out, /cave help <command>/)
  assert.equal(cave(['help', '--help']).out, cave(['help', 'help']).out)
  const unknown = cave(['help', 'frobnicate'])
  assert.equal(unknown.code, 2)
  assert.match(unknown.err, /unknown command/)
})

test('output channels are as the book documents: failures and rejections on stderr, reports on stdout', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const malformed = join(dir, 'malformed.cave')
    writeFileSync(malformed, 'la-cima SUPPLIES\n')
    const parsed = cave(['parse', malformed])
    assert.equal(parsed.code, 1)
    assert.match(parsed.err, /line 1: missing object/)
    assert.doesNotMatch(parsed.out, /missing object/)

    const missing = cave(['query', 'x IS y', '--db', db])
    assert.equal(missing.code, 1)
    assert.equal(missing.out, '')
    assert.match(missing.err, /^cave query: no store at /, 'a read never creates the store (spec §13.7)')
    assert.equal(missing.err.trimEnd().split('\n').length, 1, 'a simple failure is one line on stderr')

    const shape = join(dir, 'shape.cave')
    writeFileSync(shape, 'lot EXPECTS price\nlot/tolima-27 IS lot\n')
    assert.equal(cave(['add', shape, '--db', db]).code, 0)

    const simple = cave(['query', 'x IS y', '--db', db, '--as-of', 'yesterday'])
    assert.equal(simple.code, 1)
    assert.equal(simple.out, '')
    assert.equal(simple.err.trimEnd().split('\n').length, 1, 'a simple failure is one line on stderr')
    const gated = join(dir, 'gated.cave')
    writeFileSync(gated, 'lot/tolima-28 IS lot\n')
    const rejected = cave(['add', gated, '--db', db, '--check'])
    assert.equal(rejected.code, 1)
    assert.equal(rejected.out, '')
    assert.match(rejected.err, /^rejected: 1 new violation\(s\)/)
    assert.match(rejected.err, /\n  lot\/tolima-28 missing attribute price/, 'one line per violation on stderr')

    const report = cave(['check', '--db', db])
    assert.equal(report.code, 1)
    assert.equal(report.err, '')
    assert.match(report.out, /missing attribute price/, 'check prints its report on stdout')
  })
})

test('version, demo, and help reject surplus positional arguments with status 2', () => {
  for (const argv of [['version', 'extra'], ['--version', 'extra'], ['demo', 'extra'], ['help', 'query', 'extra']]) {
    const result = cave(argv)
    assert.equal(result.code, 2, argv.join(' '))
    assert.match(result.err, /unexpected positional arguments/, argv.join(' '))
    assert.equal(result.out, '')
  }
  assert.equal(cave(['help', 'query']).code, 0)
  assert.throws(() => cave(['version', '--json']), /Unknown option/)
})

test('--db defaults to $CAVE_DB, then cave.db in the cwd', () => {
  withDir(dir => {
    const file = join(dir, 'k.cave')
    writeFileSync(file, 'auth USES jwt\n')
    const previous = process.env['CAVE_DB']
    process.env['CAVE_DB'] = join(dir, 'env.db')
    try {
      assert.equal(addCommand([file]).code, 0)
      assert.ok(existsSync(join(dir, 'env.db')), 'store created at $CAVE_DB')
      assert.equal(queryCommand(['auth USES ?x']).out, '?x = jwt\n')
      assert.match(exportCommand([]).out, /auth USES jwt/)
    } finally {
      if (previous === undefined) {
        delete process.env['CAVE_DB']
      } else {
        process.env['CAVE_DB'] = previous
      }
    }
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      assert.equal(addCommand([file]).code, 0)
      assert.ok(existsSync(join(dir, 'cave.db')), 'store created at ./cave.db')
      assert.equal(queryCommand(['auth USES ?x']).out, '?x = jwt\n')
    } finally {
      process.chdir(cwd)
    }
  })
})

test('doctor reports a missing store without creating it and emits safe JSON', () => {
  withDir(dir => {
    const secret = 'customer-velvet-secret'
    const db = join(dir, `${secret}.db`)
    const hooks = join(dir, `${secret}-hooks.json`)
    writeFileSync(hooks, JSON.stringify({ [secret]: `curl https://${secret}.example` }))

    const result = doctorCommand(['--db', db, '--hooks', hooks, '--json'])
    assert.equal(result.code, 0, result.err || result.out)
    const report = JSON.parse(result.out)
    assert.equal(report.format, 'cave.doctor')
    assert.equal(report.version, 1)
    assert.equal(report.ok, true)
    assert.equal(report.configuration.database.source, 'flag')
    assert.equal(report.configuration.database.exists, false)
    assert.equal(report.configuration.hooks.entries, 1)
    assert.ok(report.checks.some((entry: { id: string, status: string }) =>
      entry.id === 'store.database' && entry.status === 'warn'))
    assert.doesNotMatch(result.out, new RegExp(secret))
    assert.doesNotMatch(result.out, /curl|https:/)
    assert.equal(existsSync(db), false, 'doctor must not create a missing database')
  })
})

test('doctor validates an existing store without modifying or migrating it', () => {
  withDir(dir => {
    const db = join(dir, 'knowledge.db')
    const file = join(dir, 'knowledge.cave')
    writeFileSync(file, 'auth USES jwt\n')
    assert.equal(addCommand([file, '--db', db]).code, 0)

    const before = readFileSync(db)
    const healthy = doctorCommand(['--db', db, '--json'])
    const report = JSON.parse(healthy.out)
    assert.equal(healthy.code, 0, healthy.err)
    assert.equal(report.configuration.database.schemaVersion, Schema.currentVersion)
    assert.equal(report.configuration.database.claims, 1)
    assert.ok(report.checks.some((entry: { id: string, status: string }) =>
      entry.id === 'store.integrity' && entry.status === 'pass'))
    assert.ok(report.checks.some((entry: { id: string, status: string }) =>
      entry.id === 'store.search' && entry.status === 'pass'))
    assert.deepEqual(readFileSync(db), before, 'doctor must leave a healthy database byte-for-byte unchanged')

    const future = open(db)
    future.db.exec(`PRAGMA user_version = ${Schema.currentVersion + 1}`)
    future.close()
    const futureBytes = readFileSync(db)
    const unsupported = doctorCommand(['--db', db, '--json'])
    assert.equal(unsupported.code, 1)
    assert.match(unsupported.out, /newer than supported/)
    assert.deepEqual(readFileSync(db), futureBytes, 'doctor must not downgrade a future schema')
  })
})

test('doctor distinguishes literal CAVE prefixes from unrelated SQLite objects', () => {
  for (const name of ['caveat', 'idxXcaveYnotes', 'cave_notes', 'idx_cave_notes', 'CAVE_NOTES']) withDir(dir => {
    const db = join(dir, 'private-uninitialized.db')
    const sqlite = new DatabaseSync(db)
    try {
      sqlite.exec(`CREATE TABLE ${name} (value TEXT); INSERT INTO ${name} VALUES ('private-content')`)
    } finally { sqlite.close() }
    const before = readFileSync(db)
    const isCave = ['cave_notes', 'idx_cave_notes', 'CAVE_NOTES'].includes(name)
    for (const format of [[], ['--json']]) {
      const result = doctorCommand(['--db', db, ...format])
      assert.equal(result.code, 0, result.out)
      assert.equal(result.err, '')
      assert.match(result.out, isCave ? /needs migration/ : /not initialized as a CAVE store/)
      assert.doesNotMatch(result.out, /private/)
      if (format.length > 0) {
        const report = JSON.parse(result.out)
        assert.equal(report.configuration.database.schemaVersion, 0)
        assert.ok(report.checks.some((entry: { id: string, status: string }) =>
          entry.id === 'store.database' && entry.status === 'warn'))
      }
      assert.deepEqual(readFileSync(db), before)
    }
  })
})

test('doctor reports a damaged current schema without exposing SQLite details', () => {
  for (const mutation of [
    'DROP TABLE cave_context',
    'DROP TABLE cave_fts; CREATE VIRTUAL TABLE cave_fts USING rtree(claim_id, subject, verb, object, attribute, value_text, comment, raw_line, cave_fts)',
    'DROP TABLE cave_fts; CREATE VIEW cave_fts AS SELECT id AS claim_id, subject, verb, object, attribute, value_text, comment, raw_line FROM cave_claim',
    'DROP TABLE cave_fts; CREATE TABLE cave_fts AS SELECT id AS claim_id, subject, verb, object, attribute, value_text, comment, raw_line FROM cave_claim'
  ]) withDir(dir => {
    const secret = 'private-corrupt-store'
    const db = join(dir, `${secret}.db`)
    const store = open(db)
    store.db.exec(mutation)
    store.close()
    const before = readFileSync(db)

    const result = doctorCommand(['--db', db, '--json'])
    assert.equal(result.code, 1)
    const report = JSON.parse(result.out)
    assert.equal(report.configuration.database.schemaVersion, Schema.currentVersion)
    assert.ok(report.checks.some((entry: { id: string, status: string }) =>
      entry.id === 'store.database' && entry.status === 'fail'))
    assert.doesNotMatch(result.out, new RegExp(secret))
    assert.deepEqual(readFileSync(db), before, 'doctor must not attempt schema repair')
  })
})

test('doctor detects invalid stored fields without exposing or repairing rows', () => {
  for (const mutation of [
    'UPDATE cave_claim SET conf = -0.1',
    'UPDATE cave_claim SET conf = 1.1',
    "UPDATE cave_claim SET conf = 'private-confidence'",
    'UPDATE cave_claim SET conf = 1e999',
    'UPDATE cave_claim SET sigma_level = 0',
    'UPDATE cave_claim SET sigma_level = -1',
    "UPDATE cave_claim SET sigma_level = 'private-sigma'",
    'UPDATE cave_claim SET sigma_level = 1e999',
    'UPDATE cave_claim SET value_num = 42',
    "UPDATE cave_claim SET value_unit = 'private-value-unit'",
    'UPDATE cave_claim SET value_approx = 1',
    'UPDATE cave_claim SET delta_num = 2',
    "UPDATE cave_claim SET delta_unit = 'private-delta-unit'",
    'UPDATE cave_claim SET value_approx = -1',
    "UPDATE cave_claim SET value_approx = 'private-approximation'",
    'UPDATE cave_claim SET negated = -1',
    "UPDATE cave_claim SET importance = 'private-invalid-flag'",
    "UPDATE cave_claim SET value_text = '42'",
    "UPDATE cave_claim SET attribute = 'private-attribute'",
    "UPDATE cave_claim SET object = NULL, attribute = 'private-attribute'"
  ]) withDir(dir => {
    const db = join(dir, 'private-row-store.db')
    const store = open(db)
    let id: string
    try {
      id = store.ingest('private-entity IS person').ids[0]!
      store.db.exec(mutation)
    } finally { store.close() }
    const before = readFileSync(db)
    for (const format of [[], ['--json']]) {
      const result = doctorCommand(['--db', db, ...format])
      assert.equal(result.code, 1, mutation)
      assert.doesNotMatch(result.out + result.err, /private/)
      assert.ok(!(result.out + result.err).includes(id))
      if (format.length > 0) {
        const report = JSON.parse(result.out)
        assert.ok(report.checks.some((entry: { id: string, status: string }) => entry.id === 'store.rows' && entry.status === 'fail'))
      }
      assert.deepEqual(readFileSync(db), before)
    }
    const repair = open(db)
    try {
      repair.db.exec('UPDATE cave_claim SET conf = 1, sigma_level = 2, negated = 0, importance = 0, value_approx = 0, object = \'person\', attribute = NULL, value_text = NULL, value_num = NULL, value_unit = NULL, delta_num = NULL, delta_unit = NULL')
    } finally { repair.close() }
    const recovered = doctorCommand(['--db', db, '--json'])
    assert.equal(recovered.code, 0, recovered.out)
    assert.ok(JSON.parse(recovered.out).checks.some((entry: { id: string, status: string }) => entry.id === 'store.rows' && entry.status === 'pass'))
  })
})

test('doctor detects malformed transaction identities even when integrity and search checks pass', () => {
  const other = '018f0000-0000-7000-8000-000000000002'
  for (const identity of [
    { id: other, tx: '018f0000-0000-7000-8000-000000000003' },
    { id: 'private-identity', tx: 'private-identity' },
    { id: '018F0000-0000-7000-8000-000000000002', tx: '018F0000-0000-7000-8000-000000000002' },
    { id: null, tx: other }
  ]) withDir(dir => {
    const db = join(dir, 'private-identity.db')
    const store = open(db)
    let original: string
    try {
      original = store.ingest('private-subject IS retained').ids[0]!
      store.db.prepare('UPDATE cave_claim SET id = ?, tx = ?').run(identity.id, identity.tx)
      store.db.prepare('UPDATE cave_fts SET claim_id = ?').run(identity.id)
    } finally { store.close() }
    const before = readFileSync(db)
    for (const format of [[], ['--json']]) {
      const result = doctorCommand(['--db', db, ...format])
      assert.equal(result.code, 1, result.out)
      assert.equal(result.err, '')
      assert.doesNotMatch(result.out, /private|018[fF]0000/)
      if (format.length > 0) {
        const checks = JSON.parse(result.out).checks as { id: string, status: string }[]
        for (const id of ['store.integrity', 'store.search']) {
          assert.ok(checks.some(check => check.id === id && check.status === 'pass'))
        }
        assert.ok(checks.some(check => check.id === 'store.rows' && check.status === 'fail'))
      }
      assert.deepEqual(readFileSync(db), before)
    }
    const repair = new DatabaseSync(db)
    try {
      repair.prepare('UPDATE cave_claim SET id = ?, tx = ?').run(original, original)
      repair.prepare('UPDATE cave_fts SET claim_id = ?').run(original)
    } finally { repair.close() }
    assert.equal(doctorCommand(['--db', db, '--json']).code, 0)
  })
})

test('doctor checks one database snapshot while a concurrent writer changes numeric caches', t => {
  withDir(dir => {
    const db = join(dir, 'doctor-snapshot.db')
    const writer = open(db)
    try {
      writer.db.exec('PRAGMA journal_mode = WAL')
      writer.ingest('sample HAS amount: 42')
      const prepare = DatabaseSync.prototype.prepare
      let changed = false
      const intercepted = t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
        if (sql === 'SELECT * FROM cave_claim' && !changed) {
          changed = true
          writer.db.exec('UPDATE cave_claim SET value_num = 999')
        }
        return prepare.call(this, sql)
      })
      const first = doctorCommand(['--db', db, '--json'])
      intercepted.mock.restore()
      assert.equal(changed, true)
      assert.equal(first.code, 0, first.out)
      assert.ok(JSON.parse(first.out).checks.some((entry: { id: string, status: string }) =>
        entry.id === 'store.rows' && entry.status === 'pass'))
      assert.equal(writer.currentBeliefs()[0]!.value_num, 999)
      const next = doctorCommand(['--db', db, '--json'])
      assert.equal(next.code, 1, next.out)
      assert.ok(JSON.parse(next.out).checks.some((entry: { id: string, status: string }) =>
        entry.id === 'store.rows' && entry.status === 'fail'))
      writer.db.exec('UPDATE cave_claim SET value_num = 42')
      const repaired = doctorCommand(['--db', db, '--json'])
      assert.equal(repaired.code, 0, repaired.out)
    } finally { writer.close() }
  })
})

test('doctor captures programmatic database and hook options before inspection', t => {
  withDir(dir => {
    const db = join(dir, 'captured-diagnosis.db')
    const hooks = join(dir, 'hooks.json')
    const store = open(db)
    store.close()
    writeFileSync(hooks, '{}')
    let dbReads = 0, hookReads = 0, selectedHooks = hooks
    const options = {
      get db() { return ++dbReads === 1 ? db : undefined },
      get hooks() { hookReads++; return selectedHooks }
    }
    const prepare = DatabaseSync.prototype.prepare
    const intercepted = t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
      if (sql === 'PRAGMA user_version') selectedHooks = join(dir, 'missing-hooks.json')
      return prepare.call(this, sql)
    })
    let report: ReturnType<typeof diagnose>
    try { report = diagnose(options) } finally { intercepted.mock.restore() }
    assert.equal(dbReads, 1)
    assert.equal(hookReads, 1)
    assert.equal(report.ok, true)
    assert.equal(report.configuration.database.source, 'flag')
    assert.equal(report.configuration.hooks.source, 'flag')
    assert.equal(report.configuration.hooks.exists, true)
    assert.ok(report.checks.some(entry => entry.id === 'config.hooks' && entry.status === 'pass'))
    const changed = diagnose({ db, hooks: selectedHooks })
    assert.equal(changed.ok, false)
    assert.ok(changed.checks.some(entry => entry.id === 'config.hooks' && entry.status === 'fail'))
  })
})

test('doctor distinguishes text-store cleanup failure from loading failure', t => {
  for (const unreadable of [false, true]) withDir(dir => {
    const path = join(dir, 'private-text.cave')
    writeFileSync(path, 'private-subject IS person\n')
    const before = readFileSync(path)
    const close = DatabaseSync.prototype.close
    let closes = 0
    const intercepted = t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      const textStore = this.location() === null && this.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'cave_claim'").get() !== undefined
      close.call(this)
      if (textStore) {
        closes++
        throw unreadable ? Object.create(null) : new Error('private text-store close failure')
      }
    })
    try {
      for (const format of [[], ['--json']]) {
        const result = doctorCommand(['--db', path, ...format])
        assert.equal(result.code, 1)
        assert.equal(result.err, '')
        assert.doesNotMatch(result.out, /private/)
        if (format.length > 0) {
          const report = JSON.parse(result.out)
          assert.equal(report.configuration.database.kind, 'text')
          assert.equal(report.configuration.database.claims, 1)
          assert.ok(report.checks.some((entry: { id: string, status: string }) =>
            entry.id === 'store.database' && entry.status === 'pass'))
          assert.ok(report.checks.some((entry: { id: string, status: string }) =>
            entry.id === 'store.cleanup' && entry.status === 'fail'))
        }
        assert.deepEqual(readFileSync(path), before)
      }
      assert.equal(closes, 2)
    } finally { intercepted.mock.restore() }
    assert.equal(doctorCommand(['--db', path, '--json']).code, 0)
  })
})

test('doctor retains SQLite capability results when probe close also fails', t => {
  for (const failedProbe of [false, true]) for (const unreadable of [false, true]) withDir(dir => {
    const db = join(dir, 'probe-cleanup.db')
    const store = open(db)
    store.close() // Initialize the adapter's text probe before intercepting doctor.
    const exec = DatabaseSync.prototype.exec, close = DatabaseSync.prototype.close
    let closes = 0
    const execution = t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
      if (failedProbe && sql === 'CREATE VIRTUAL TABLE doctor_fts USING fts5(value)') throw new Error('private capability failure')
      return exec.call(this, sql)
    })
    const closing = t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      const probe = this.location() === null
      close.call(this)
      if (probe) {
        closes++
        throw unreadable ? Object.create(null) : new Error('private probe close failure')
      }
    })
    try {
      for (const format of [[], ['--json']]) {
        let result: ReturnType<typeof doctorCommand> | undefined
        assert.doesNotThrow(() => { result = doctorCommand(['--db', db, ...format]) })
        assert.ok(result)
        assert.equal(result.code, 1)
        assert.equal(result.err, '')
        assert.doesNotMatch(result.out, /private/)
        if (format.length > 0) {
          const report = JSON.parse(result.out)
          assert.equal(report.ok, false)
          assert.ok(report.checks.some((entry: { id: string, status: string }) =>
            entry.id === 'runtime.sqlite.cleanup' && entry.status === 'fail'))
          assert.ok(report.checks.some((entry: { id: string, status: string }) =>
            entry.id === 'runtime.sqlite' && entry.status === (failedProbe ? 'fail' : 'pass')))
        }
      }
      assert.equal(closes, 2)
    } finally { execution.mock.restore(); closing.mock.restore() }
    assert.equal(doctorCommand(['--db', db, '--json']).code, 0)
  })
})

test('doctor retains redacted row diagnostics when database close also fails', t => {
  for (const invalid of [false, true]) for (const unreadable of [false, true]) withDir(dir => {
    const db = join(dir, 'private-close.db')
    const store = open(db)
    try {
      store.ingest('private-entity IS person')
      if (invalid) store.db.exec('UPDATE cave_claim SET value_num = 42')
    } finally { store.close() }
    const before = readFileSync(db)
    const close = DatabaseSync.prototype.close
    let closes = 0
    const intercepted = t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      const target = this.location()?.endsWith('private-close.db') === true
      close.call(this)
      if (target) {
        closes++
        throw unreadable ? Object.create(null) : new Error('private close failure')
      }
    })
    try {
      for (const format of [[], ['--json']]) {
        let result: ReturnType<typeof doctorCommand> | undefined
        assert.doesNotThrow(() => { result = doctorCommand(['--db', db, ...format]) })
        assert.ok(result)
        assert.equal(result.code, 1)
        assert.equal(result.err, '')
        assert.doesNotMatch(result.out, /private/)
        if (format.length > 0) {
          const report = JSON.parse(result.out)
          assert.equal(report.ok, false)
          assert.ok(report.checks.some((entry: { id: string, status: string }) =>
            entry.id === 'store.cleanup' && entry.status === 'fail'))
          assert.ok(report.checks.some((entry: { id: string, status: string }) =>
            entry.id === 'store.rows' && entry.status === (invalid ? 'fail' : 'pass')))
        }
        assert.deepEqual(readFileSync(db), before)
      }
      assert.equal(closes, 2)
    } finally { intercepted.mock.restore() }
    assert.equal(doctorCommand(['--db', db, '--json']).code, invalid ? 1 : 0)
  })
})

test('doctor releases rollback-journal read locks after healthy and invalid-row reports', t => {
  withDir(dir => {
    const db = join(dir, 'doctor-locks.db')
    const writer = open(db)
    try {
      writer.db.exec('PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 0')
      assert.equal(writer.db.prepare('PRAGMA journal_mode').get()?.['journal_mode'], 'delete')
      writer.ingest('sample HAS amount: 42')
      const prepare = DatabaseSync.prototype.prepare
      let attempted = false
      const intercepted = t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
        if (sql === 'SELECT * FROM cave_claim' && !attempted) {
          attempted = true
          assert.throws(() => writer.db.exec('UPDATE cave_claim SET value_num = 999'), /database is locked/)
        }
        return prepare.call(this, sql)
      })
      const healthy = doctorCommand(['--db', db, '--json'])
      intercepted.mock.restore()
      assert.equal(attempted, true)
      assert.equal(healthy.code, 0, healthy.out)
      assert.equal(writer.currentBeliefs()[0]!.value_num, 42)
      // Returning from doctor releases the read lock, without closing the writer.
      writer.db.exec('UPDATE cave_claim SET value_num = 999')
      const unhealthy = doctorCommand(['--db', db, '--json'])
      assert.equal(unhealthy.code, 1, unhealthy.out)
      assert.ok(JSON.parse(unhealthy.out).checks.some((entry: { id: string, status: string }) =>
        entry.id === 'store.rows' && entry.status === 'fail'))
      // An invalid-row report must release its read lock too.
      writer.db.exec('UPDATE cave_claim SET value_num = 42')
      const repaired = doctorCommand(['--db', db, '--json'])
      assert.equal(repaired.code, 0, repaired.out)
    } finally { writer.close() }
  })
})

test('doctor accepts consistent numeric, unit and literal projections without writing', () => {
  withDir(dir => {
    const db = join(dir, 'numeric-projections.db')
    const store = open(db)
    try {
      store.ingest('sample HAS revenue: ~20B USD/yr +/- 2B USD/yr\nlabel HAS name: "42"\ncode HAS token: `42`\nsmall HAS amount: 1e-313')
    } finally { store.close() }
    const before = readFileSync(db)
    const result = doctorCommand(['--db', db, '--json'])
    assert.equal(result.code, 0, result.out)
    assert.ok(JSON.parse(result.out).checks.some((entry: { id: string, status: string }) =>
      entry.id === 'store.rows' && entry.status === 'pass'))
    assert.deepEqual(readFileSync(db), before)
  })
})

test('doctor rejects empty and binary provenance without exposing values or changing the store', () => {
  for (const dimension of ['actor', 'source', 'run', 'domain']) for (const value of ['', Buffer.from('private-provenance')]) withDir(dir => {
    const db = join(dir, 'private-provenance.db')
    const store = open(db)
    let id: string
    try {
      id = store.ingest('private-entity IS retained').ids[0]!
      store.db.prepare('INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)').run(id, dimension, value)
    } finally { store.close() }
    const before = readFileSync(db)
    for (const format of [[], ['--json']]) {
      const result = doctorCommand(['--db', db, ...format])
      assert.equal(result.code, 1)
      assert.doesNotMatch(result.out + result.err, /private/)
      assert.ok(!(result.out + result.err).includes(id))
      if (format.length) assert.ok(JSON.parse(result.out).checks.some((entry: { id: string, status: string }) =>
        entry.id === 'store.rows' && entry.status === 'fail'))
      assert.deepEqual(readFileSync(db), before)
    }
    for (const valid of ['repaired', '\0']) {
      const repair = new DatabaseSync(db)
      try { repair.prepare('UPDATE cave_provenance SET value = ? WHERE claim_id = ? AND dimension = ?').run(valid, id, dimension) }
      finally { repair.close() }
      const recovered = doctorCommand(['--db', db, '--json'])
      assert.equal(recovered.code, 0, recovered.out)
      assert.ok(JSON.parse(recovered.out).checks.some((entry: { id: string, status: string }) =>
        entry.id === 'store.rows' && entry.status === 'pass'))
    }
  })
})

test('doctor detects historical claim key and context disagreement without exposing data', () => {
  for (const corruption of ['key', 'context']) withDir(dir => {
    const db = join(dir, 'private-identity.db')
    const store = open(db)
    let id: string, key: string
    try {
      store.ingest('private-entity HAS count: 1 @private-context @src:private-source')
      store.ingest('private-entity HAS count: 2 @private-context @src:private-source')
      const oldest = store.db.prepare('SELECT id, claim_key FROM cave_claim ORDER BY tx LIMIT 1').get()!
      id = oldest.id as string
      key = oldest.claim_key as string
      if (corruption === 'key') store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run('private-wrong-key', id)
      else store.db.prepare('DELETE FROM cave_context WHERE claim_id = ? AND context = ?').run(id, 'private-context')
    } finally { store.close() }
    const before = readFileSync(db)
    for (const format of [[], ['--json']]) {
      const result = doctorCommand(['--db', db, ...format])
      assert.equal(result.code, 1, result.out)
      assert.doesNotMatch(result.out + result.err, /private/)
      assert.ok(!(result.out + result.err).includes(id))
      if (format.length) assert.ok(JSON.parse(result.out).checks.some((entry: { id: string, status: string }) =>
        entry.id === 'store.rows' && entry.status === 'fail'))
      assert.deepEqual(readFileSync(db), before)
    }
    const repair = new DatabaseSync(db)
    try {
      if (corruption === 'key') repair.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(key, id)
      else repair.prepare('INSERT INTO cave_context (claim_id, context) VALUES (?, ?)').run(id, 'private-context')
    } finally { repair.close() }
    const recovered = doctorCommand(['--db', db, '--json'])
    assert.equal(recovered.code, 0, recovered.out)
    assert.ok(JSON.parse(recovered.out).checks.some((entry: { id: string, status: string }) =>
      entry.id === 'store.rows' && entry.status === 'pass'))
  })
})

test('doctor accepts confidence endpoints and positive finite or default sigma levels', () => {
  withDir(dir => {
    const db = join(dir, 'numeric-boundaries.db')
    for (const conf of [0, 1]) for (const sigma of [null, Number.MIN_VALUE, 0.5, 2, Number.MAX_VALUE]) {
      const store = open(db)
      try {
        store.ingest('item IS valid')
        store.db.prepare('UPDATE cave_claim SET conf = ?, sigma_level = ?').run(conf, sigma)
      } finally { store.close() }
      const before = readFileSync(db)
      const result = doctorCommand(['--db', db, '--json'])
      assert.equal(result.code, 0, result.out)
      assert.ok(JSON.parse(result.out).checks.some((entry: { id: string, status: string }) =>
        entry.id === 'store.rows' && entry.status === 'pass'))
      assert.deepEqual(readFileSync(db), before)
    }
  })
})

test('doctor detects missing, duplicate, orphaned, and stale search entries without writing', () => {
  for (const mutation of [
    'DELETE FROM cave_fts',
    'INSERT INTO cave_fts SELECT * FROM cave_fts',
    "UPDATE cave_fts SET claim_id = 'orphan'",
    "UPDATE cave_fts SET comment = 'stale-index-private-value'",
    "DELETE FROM cave_fts WHERE subject = 'private-second'; INSERT INTO cave_fts SELECT * FROM cave_fts WHERE subject = 'private-entity'",
  ]) withDir(dir => {
    const db = join(dir, 'private-search-store.db')
    const store = open(db)
    store.ingest('private-entity IS person ; private-comment\nprivate-second IS person')
    store.db.exec(mutation)
    store.close()
    const before = readFileSync(db)
    const result = doctorCommand(['--db', db, '--json'])
    assert.equal(result.code, 1, mutation)
    const report = JSON.parse(result.out)
    assert.ok(report.checks.some((entry: { id: string, status: string }) => entry.id === 'store.integrity' && entry.status === 'pass'))
    assert.ok(report.checks.some((entry: { id: string, status: string }) => entry.id === 'store.search' && entry.status === 'fail'))
    assert.doesNotMatch(result.out + result.err, /private/)
    assert.deepEqual(readFileSync(db), before)
  })
})

test('doctor text-store failures never expose source names, paths, or malformed input', () => {
  withDir(dir => {
    const secret = 'private-doctor-secret'
    const notes = join(dir, `${secret}.cave`)
    for (const text of [
      `${secret} lowercase invalid`,
      `source/${secret} HAS path: ${secret}.csv\nsource/${secret} HAS map: missing.map.cave`,
    ]) {
      writeFileSync(notes, text)
      for (const format of [[], ['--json']]) {
        const result = doctorCommand(['--db', notes, ...format])
        assert.equal(result.code, 1)
        assert.ok(!(result.out + result.err).includes(secret), result.out)
        assert.ok(!(result.out + result.err).includes(dir), result.out)
        assert.deepEqual(readFileSync(notes, 'utf8'), text)
      }
    }
  })
})

test('doctor targets malformed hooks and validates its arguments without leaking input', () => {
  withDir(dir => {
    const secret = 'hook-secret-command'
    const hooks = join(dir, `${secret}.json`)
    writeFileSync(hooks, JSON.stringify([secret]))
    const malformed = doctorCommand(['--hooks', hooks, '--json'])
    assert.equal(malformed.code, 1)
    assert.match(malformed.out, /hooks file is unreadable or malformed/)
    assert.doesNotMatch(malformed.out, new RegExp(secret))

    const unexpected = doctorCommand(['private-positional-value'])
    assert.equal(unexpected.code, 2)
    assert.equal(unexpected.err, 'cave doctor: unexpected positional arguments\n')
    assert.doesNotMatch(unexpected.err, /private-positional-value/)
  })
})

test('version prints the package version', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { version: string }
  for (const argv of [['version'], ['--version'], ['-v']]) {
    const result = cave(argv)
    assert.equal(result.code, 0)
    assert.equal(result.out, `${manifest.version}\n`)
  }
})

test('demo narrates the multi-hop recovery', () => {
  const result = demoCommand()
  assert.equal(result.code, 0)
  assert.match(result.out, /reconstructed claims:/)
  assert.match(result.out, /FIX token-expiry/)
})

const withDirAsync = async (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-'))
  try {
    await body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const reconstructKnowledge = [
  'auth/middleware HAS bug: token-expiry',
  'token-expiry CAUSE reject-valid-tokens',
  'topic/auth-hardening CONTAINS token-expiry',
  'unrelated/service USES postgres'
].join('\n')

test('reconstruct walks the store from seed cues; --trace lines are comments', () =>
  withDirAsync(async dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, reconstructKnowledge)
    assert.equal(addCommand(['--db', db, file]).code, 0)
    const result = await reconstructCommand(['--db', db, 'reject-valid-tokens', '--trace'])
    assert.equal(result.code, 0, result.err)
    assert.match(result.out, /; 1\. reject-valid-tokens @ 1\.00/)
    assert.match(result.out, /claim\(s\)\n\n[^;\n]/, 'a blank line keeps the trace off the first claim (spec §6.4)')
    assert.match(result.out, /token-expiry CAUSE reject-valid-tokens/)
    assert.match(result.out, /topic\/auth-hardening CONTAINS token-expiry/)
    assert.doesNotMatch(result.out, /unrelated\/service/)
  }))

test('reconstruct --agent drives the LLM policy through a shell agent', () =>
  withDirAsync(async dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, reconstructKnowledge)
    assert.equal(addCommand(['--db', db, file]).code, 0)
    // The agent expands the strongest offered cue every step, like the
    // heuristic; the prompt lists cues strongest first.
    const script = join(dir, 'agent.js')
    writeFileSync(script, [
      `let d = ''`,
      `process.stdin.on('data', c => d += c).on('end', () => {`,
      `  const lines = d.split('\\n')`,
      `  const at = lines.findIndex(line => line.startsWith('Frontier cues'))`,
      `  const first = (lines[at + 1] ?? '').split(' @ ')[0]`,
      `  process.stdout.write(first === '' ? 'STOP' : first)`,
      `})`
    ].join('\n'))
    const llm = await reconstructCommand([
      '--db', db, 'reject-valid-tokens', '--agent', `node ${script}`, '--query', 'why?'
    ])
    assert.equal(llm.code, 0, llm.err)
    const baseline = await reconstructCommand(['--db', db, 'reject-valid-tokens'])
    assert.equal(llm.out, baseline.out, 'strongest-cue agent matches the heuristic baseline')

    const failing = await reconstructCommand(['--db', db, 'reject-valid-tokens', '--agent', 'exit 5'])
    assert.equal(failing.code, 1)
    assert.match(failing.err, /agent exited with 5/)
  }))

test('reconstruct validates its arguments', async () => {
  const noSeeds = await reconstructCommand([])
  assert.equal(noSeeds.code, 1)
  assert.match(noSeeds.err, /at least one seed/)
  const badSteps = await reconstructCommand(['seed', '--steps', '0'])
  assert.equal(badSteps.code, 1)
  assert.match(badSteps.err, /--steps must be a positive integer/)
  const badTimeout = await reconstructCommand(['seed', '--timeout=0'])
  assert.equal(badTimeout.code, 1)
  assert.match(badTimeout.err, /--timeout/)
  const parseError = await reconstructCommand(['seed', '--timeout', '-1'])
  assert.equal(parseError.code, 1, 'parseArgs errors fail cleanly instead of throwing')
  const help = await reconstructCommand(['--help'])
  assert.equal(help.code, 0)
  assert.match(help.out, /Usage:/)
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

test('annotated export preserves its output file when stored transaction identity is corrupt', () => {
  withDir(dir => {
    const db = join(dir, 'knowledge.db'), output = join(dir, 'retained.cave')
    const store = open(db)
    let id: string
    try {
      store.ingest('visible IS retained #sensitivity:public')
      id = store.ingest('private-subject IS retained #sensitivity:restricted').ids[0]!
      store.db.prepare('UPDATE cave_claim SET tx = ? WHERE id = ?')
        .run('018f0000-0000-7000-8000-000000000002', id)
    } finally { store.close() }
    const before = readFileSync(db)
    writeFileSync(output, 'retained output')
    const failed = exportCommand(['--db', db, '--tx', '--max-sensitivity', 'restricted', '--out', output])
    assert.equal(failed.code, 1)
    assert.equal(failed.out, '')
    assert.match(failed.err, /transaction identity/)
    assert.ok(failed.err.includes(id))
    assert.doesNotMatch(failed.err, /private-subject/)
    assert.equal(readFileSync(output, 'utf8'), 'retained output')
    assert.deepEqual(readFileSync(db), before)
    const publicExport = exportCommand(['--db', db, '--tx', '--max-sensitivity', 'public'])
    assert.equal(publicExport.code, 0, publicExport.err)
    assert.match(publicExport.out, /visible IS retained/)
    assert.doesNotMatch(publicExport.out, /private-subject/)
    const repair = new DatabaseSync(db)
    try { repair.prepare('UPDATE cave_claim SET tx = ? WHERE id = ?').run(id, id) }
    finally { repair.close() }
    const recovered = exportCommand(['--db', db, '--tx', '--max-sensitivity', 'restricted', '--out', output])
    assert.equal(recovered.code, 0, recovered.err)
    assert.ok(readFileSync(output, 'utf8').includes(id))
  })
})

for (const corruption of ['provenance', 'claim key']) test(`annotated export preserves its output file when stored ${corruption} is malformed`, () => {
  withDir(dir => {
    const db = join(dir, 'knowledge.db'), output = join(dir, 'retained.cave')
    const store = open(db)
    let id: string, key: string
    try {
      store.ingest('visible IS retained #sensitivity:public')
      id = store.ingest('private-subject IS retained #sensitivity:restricted').ids[0]!
      key = store.currentBeliefs().find(row => row.id === id)!.claim_key
      if (corruption === 'provenance') {
        store.db.prepare('INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)').run(id, 'source', '')
      } else {
        store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run('incorrect-key', id)
      }
    } finally { store.close() }
    const before = readFileSync(db)
    writeFileSync(output, 'retained output')
    const failed = exportCommand(['--db', db, '--tx', '--max-sensitivity', 'restricted', '--out', output])
    assert.equal(failed.code, 1)
    assert.equal(failed.out, '')
    assert.ok(failed.err.includes(`stored ${corruption}`), failed.err)
    assert.ok(failed.err.includes(id))
    assert.doesNotMatch(failed.err, /private-subject/)
    assert.equal(readFileSync(output, 'utf8'), 'retained output')
    assert.deepEqual(readFileSync(db), before)
    const publicExport = exportCommand(['--db', db, '--tx', '--max-sensitivity', 'public'])
    assert.equal(publicExport.code, 0, publicExport.err)
    assert.doesNotMatch(publicExport.out, /private-subject/)
    const repair = new DatabaseSync(db)
    try {
      if (corruption === 'provenance') repair.prepare('UPDATE cave_provenance SET value = ? WHERE claim_id = ?').run('repaired', id)
      else repair.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(key, id)
    }
    finally { repair.close() }
    const recovered = exportCommand(['--db', db, '--tx', '--max-sensitivity', 'restricted', '--out', output])
    assert.equal(recovered.code, 0, recovered.err)
    const destination = join(dir, 'restored.db')
    const replay = syncCommand(['--db', destination, output, '--no-record', '--json'])
    assert.equal(replay.code, 0, replay.err)
    assert.deepEqual(JSON.parse(replay.out).problems, [])
    assert.equal(JSON.parse(replay.out).merged, 2)
    const restored = open(destination)
    try {
      const row = restored.currentBeliefs().find(row => row.id === id)!
      assert.equal(row.tx, id)
      assert.equal(row.claim_key, key)
    } finally { restored.close() }
  })
})

test('export --out writes a file; import restores the full belief history', () => {
  withDir(dir => {
    const original = join(dir, 'original.db')
    const restored = join(dir, 'restored.db')
    const backup = join(dir, 'backup.cave')
    const source = join(dir, 'source.cave')
    writeFileSync(source, [
      'Anthropic HAS ipo-timing: 2026-H2 @ 40% ; initial assessment',
      'Anthropic HAS ipo-timing: 2026-H2 @ 65% ; updated after CFO statement',
      'Anthropic HAS ipo-timing: 2026-H2 @ 35% ; market conditions worsened',
      'server CAUSE crash @ 80%',
      '  WHEN load > ~1000 req/s',
      'packages/api PART-OF monorepo',
      'WRAPS REVERSE WRAPPED-BY',
      'gift WRAPPED-BY paper'
    ].join('\n'))
    addCommand([source, '--db', original])

    const exported = exportCommand(['--db', original, '--out', backup])
    assert.equal(exported.code, 0)
    assert.match(exported.out, /exported 7 claim\(s\) to /, 'the WHEN qualifier is part of its parent claim')

    const imported = importCommand([backup, '--db', restored])
    assert.equal(imported.code, 0, imported.err)
    assert.match(imported.out, /added 8 claim\(s\), 1 edge\(s\)/)
    assert.equal(imported.err, '', 'a cave export imports without problems')

    // Full belief series survives: same per-key confidence sequences.
    const series = (db: string): string => {
      const store = open(db)
      const rows = store.db.prepare('SELECT claim_key, conf FROM cave_claim ORDER BY tx').all() as
        { claim_key: string, conf: number }[]
      store.close()
      const byKey = new Map<string, number[]>()
      for (const row of rows) {
        byKey.set(row.claim_key, [...byKey.get(row.claim_key) ?? [], row.conf])
      }
      return JSON.stringify([...byKey.entries()].sort())
    }
    assert.equal(series(restored), series(original))

    // The restored database answers queries identically, incl. inverse reads
    // backed by the imported in-band declaration.
    assert.equal(
      queryCommand(['monorepo CONTAINS ?x', '--db', restored]).out,
      '?x = packages/api\n'
    )
    assert.equal(
      queryCommand(['paper WRAPS ?x', '--db', restored]).out,
      '?x = gift\n'
    )
  })
})

test('backup verifies and restore preserves exact row identity and transaction order', () => {
  withDir(dir => {
    const db = join(dir, 'source.db')
    const input = join(dir, 'input.cave')
    const snapshot = join(dir, 'snapshot.db')
    const restored = join(dir, 'restored.db')
    writeFileSync(input, 'api HAS owner: platform @src:inventory\napi HAS owner: security @src:inventory\n')
    assert.equal(addCommand([input, '--db', db]).code, 0)
    const created = backupCommand(['--db', db, '--out', snapshot])
    assert.equal(created.code, 0, created.err)
    const digest = /sha256:([0-9a-f]{64})/.exec(created.out)?.[1]
    assert.ok(digest)
    const verified = backupCommand(['--verify', snapshot, '--sha256', digest!])
    assert.equal(verified.code, 0, verified.err)

    const result = restoreCommand([snapshot, '--db', restored, '--sha256', digest!])
    assert.equal(result.code, 0, result.err)
    const rows = (path: string): unknown[] => {
      const store = open(path)
      try {
        return store.db.prepare('SELECT id, tx, claim_key, raw_line FROM cave_claim ORDER BY tx').all()
      } finally {
        store.close()
      }
    }
    assert.deepEqual(rows(restored), rows(db))
    assert.equal(backupCommand(['--db', db, '--out', snapshot]).code, 1)
    assert.equal(backupCommand(['--db', db, '--out', snapshot, '--force']).code, 0)
  })
})

test('backup verification and restore report historical schema without migrating snapshot bytes', () => {
  withDir(dir => {
    const snapshot = join(dir, 'version1.db'), restored = join(dir, 'restored.db')
    const source = open(snapshot)
    source.ingest('api IS service')
    source.db.exec('DROP INDEX idx_cave_tx')
    source.db.exec('PRAGMA user_version = 1')
    source.close()
    const bytes = readFileSync(snapshot)
    const verified = backupCommand(['--verify', snapshot])
    assert.equal(verified.code, 0, verified.err)
    assert.match(verified.out, /schema v1/)
    const digest = /sha256:([0-9a-f]{64})/.exec(verified.out)?.[1]
    assert.ok(digest)
    const result = restoreCommand([snapshot, '--db', restored, '--sha256', digest])
    assert.equal(result.code, 0, result.err)
    assert.match(result.out, /schema v1/)
    assert.deepEqual(readFileSync(snapshot), bytes)
    assert.deepEqual(readFileSync(restored), bytes)
  })
})

test('backup and restore validate required arguments and digests', () => {
  assert.equal(backupCommand([]).code, 1)
  assert.equal(backupCommand(['--verify', 'missing.db', '--db', 'x.db']).code, 1)
  assert.match(backupCommand(['--verify', 'missing.db', '--sha256', 'bad']).err, /64 hexadecimal/)
  assert.match(backupCommand(['--verify', 'missing.db', '--sha256', 'a'.repeat(64) + '\n']).err, /64 hexadecimal/)
  assert.match(restoreCommand(['snapshot.db', '--db', 'out.db', '--sha256', 'a'.repeat(64) + '\n']).err, /64 hexadecimal/)
  assert.equal(restoreCommand(['snapshot.db']).code, 1)
  assert.equal(restoreCommand(['a.db', 'b.db', '--db', 'out.db']).code, 1)
  assert.match(restoreCommand(['snapshot.db', '--db', 'out.db', '--sha256', 'bad']).err, /64 hexadecimal/)
})

test('add stamps @src:cli; --no-src opts out; import replays without stamping (spec §9.5)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, 'auth USES jwt\napi USES jwt @src:design-doc\n')
    addCommand([file, '--db', db])
    const exported = exportCommand(['--db', db])
    assert.match(exported.out, /auth USES jwt @src:cli/)
    assert.match(exported.out, /api USES jwt @src:design-doc(?!.*@src:cli)/, 'a written @src: wins')

    const bare = join(dir, 'bare.db')
    addCommand([file, '--db', bare, '--no-src'])
    assert.match(exportCommand(['--db', bare]).out, /^auth USES jwt\n/)

    // Interchange replay: importing the export re-creates the same claim
    // keys — no second stamp on already-stamped (or deliberately bare) rows.
    const backup = join(dir, 'backup.cave')
    const restored = join(dir, 'restored.db')
    exportCommand(['--db', db, '--out', backup])
    importCommand([backup, '--db', restored])
    const keys = (path: string): string[] => {
      const store = open(path)
      const rows = store.db.prepare('SELECT DISTINCT claim_key FROM cave_claim ORDER BY claim_key').all() as
        { claim_key: string }[]
      store.close()
      return rows.map(row => row.claim_key)
    }
    assert.deepEqual(keys(restored), keys(db))
  })
})

test('export --current --out backs up only current beliefs', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const source = join(dir, 's.cave')
    const backup = join(dir, 'current.cave')
    writeFileSync(source, 'x HAS state: a @ 40%\n')
    addCommand([source, '--db', db])
    writeFileSync(source, 'x HAS state: b @ 90%\n')
    addCommand([source, '--db', db])
    const exported = exportCommand(['--db', db, '--current', '--out', backup])
    assert.match(exported.out, /exported 1 claim\(s\)/)
    const fresh = join(dir, 'fresh.db')
    importCommand([backup, '--db', fresh])
    const state = queryCommand(['x HAS state: ?s', '--db', fresh])
    assert.equal(state.out, '?s = b\n')
  })
})

test('export uses the shared sensitivity ceiling and validates labels (spec §9.7)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const source = join(dir, 's.cave')
    writeFileSync(source, [
      'public-item IS visible #sensitivity:public',
      'internal-item IS visible',
      'secret-item IS visible #sensitivity:confidential',
      'restricted-item IS visible #sensitivity:restricted'
    ].join('\n'))
    addCommand([source, '--db', db])
    const ordinary = exportCommand(['--db', db]).out
    assert.match(ordinary, /public-item/)
    assert.match(ordinary, /internal-item/)
    assert.doesNotMatch(ordinary, /secret-item|restricted-item/)
    const complete = exportCommand(['--db', db, '--max-sensitivity', 'restricted']).out
    assert.match(complete, /secret-item/)
    assert.match(complete, /restricted-item/)
    const invalid = exportCommand(['--db', db, '--max-sensitivity', 'secret'])
    assert.equal(invalid.code, 1)
    assert.match(invalid.err, /public, internal, confidential, restricted/)
  })
})

test('generate emits and writes a versioned typed client from EXPECTS (spec §20.4)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const shapes = join(dir, 'shapes.cave')
    const output = join(dir, 'cave-client.ts')
    writeFileSync(shapes, [
      'service EXPECTS owner #cardinality:one',
      'service EXPECTS USES'
    ].join('\n'))
    assert.equal(addCommand([shapes, '--db', db]).code, 0)
    const stdout = generateCommand(['--db', db])
    assert.equal(stdout.code, 0, stdout.err)
    assert.match(stdout.out, /typed-client\/v1/)
    assert.match(stdout.out, /export interface Service/)
    assert.match(stdout.out, /readService/)

    const written = generateCommand(['--db', db, '--out', output])
    assert.equal(written.code, 0, written.err)
    assert.match(written.out, /generated typed client v1 \(2 field\(s\), sha256:/)
    assert.equal(readFileSync(output, 'utf8'), stdout.out)
    assert.equal(generateCommand(['--db', db, '--version', '2']).code, 1)
    assert.match(generateCommand(['--db', db, '--version', 'wat']).err, /positive integer/)
    assert.equal(generateCommand(['--db', db, '--out', db]).code, 1)
  })
})

test('generate reports ambiguous schema without writing output (spec §20.4)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const shapes = join(dir, 'shapes.cave')
    const output = join(dir, 'client.ts')
    writeFileSync(shapes, 'service EXPECTS USES #unit:ms\n')
    addCommand([shapes, '--db', db])
    const generated = generateCommand(['--db', db, '--out', output])
    assert.equal(generated.code, 1)
    assert.match(generated.err, /relation expectations cannot declare #unit/)
    assert.equal(existsSync(output), false)
  })
})

test('generate preserves an existing client for binary unit declarations and recovers after repair', () => {
  withDir(dir => {
    const db = join(dir, 'k.db'), output = join(dir, 'client.ts')
    const store = open(db)
    try {
      store.ingest('service EXPECTS cost #unit:USD')
      const id = store.currentBeliefs()[0]!.id
      const args = ['--db', db, '--out', output, '--no-prelude']
      const initial = generateCommand(args)
      assert.equal(initial.code, 0, initial.err)
      const before = readFileSync(output)
      for (const value of [new Uint8Array(), new Uint8Array([85, 83, 68])]) {
        store.db.prepare("UPDATE cave_tag SET value = ? WHERE claim_id = ? AND key = 'unit'").run(value, id)
        const rejected = generateCommand(args)
        assert.equal(rejected.code, 1)
        assert.equal(rejected.out, '')
        assert.match(rejected.err, /schema cannot be generated/)
        assert.match(rejected.err, /unit must have one non-empty text value/)
        assert.deepEqual(readFileSync(output), before)
        assert.deepEqual(store.db.prepare("SELECT value FROM cave_tag WHERE claim_id = ? AND key = 'unit'").get(id)!.value, value)
        store.db.prepare("UPDATE cave_tag SET value = 'USD' WHERE claim_id = ? AND key = 'unit'").run(id)
        const recovered = generateCommand(args)
        assert.equal(recovered.code, 0, recovered.err)
        assert.deepEqual(readFileSync(output), before)
      }
    } finally { store.close() }
  })
})

test('export refuses --out that would overwrite the source database (export-clobbers-db)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, 'auth USES jwt\n')
    addCommand([file, '--db', db])

    const clobbered = exportCommand(['--db', db, '--out', db])
    assert.equal(clobbered.code, 1)
    assert.match(clobbered.err, /source database/)

    // Equivalent spellings of the same path are caught too.
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      assert.equal(exportCommand(['--db', db, '--out', 'k.db']).code, 1)
      assert.equal(exportCommand(['--db', 'k.db', '--out', db]).code, 1)
    } finally {
      process.chdir(cwd)
    }

    // Links to the database file are caught by file identity.
    const link = join(dir, 'link.db')
    symlinkSync(db, link)
    assert.equal(exportCommand(['--db', db, '--out', link]).code, 1)

    // The store survives every refused attempt and still answers.
    assert.equal(queryCommand(['auth USES ?x', '--db', db]).out, '?x = jwt\n')
  })
})

test('file output commands protect SQLite sidecar paths through database symlinks', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const input = join(dir, 'input.cave')
    const template = join(dir, 'report.md')
    writeFileSync(input, 'service EXPECTS owner\nauth USES jwt\n')
    writeFileSync(template, 'Report\n')
    assert.equal(addCommand([input, '--db', db]).code, 0)
    const linked = join(dir, 'linked.db')
    symlinkSync(db, linked)
    for (const source of [db, linked]) {
      for (const suffix of ['-wal', '-shm', '-journal']) {
        const output = `${db}${suffix}`
        for (const [command, args] of [
          [exportCommand, []], [generateCommand, []],
          [reportCommand, [template]], [backupCommand, []]
        ] as const) {
          const result = command([...args, '--db', source, '--out', output])
          assert.equal(result.code, 1, `${source} → ${output}`)
          assert.match(result.err, /source database/)
        }
      }
    }
    assert.equal(queryCommand(['auth USES ?x', '--db', db]).out, '?x = jwt\n')
  })
})

test('export returns output write failures instead of throwing (export-error-contract)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, 'auth USES jwt\n')
    addCommand([file, '--db', db])

    const failed = exportCommand(['--db', db, '--out', join(dir, 'missing', 'backup.cave')])
    assert.equal(failed.code, 1)
    assert.equal(failed.out, '')
    assert.match(failed.err, /ENOENT/)

    // The store was still closed on the failure path and answers afterwards.
    assert.equal(queryCommand(['auth USES ?x', '--db', db]).out, '?x = jwt\n')
  })
})

test('export counts root claims — qualifier/grouping lines are not claims (export-error-contract)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      'server CAUSE crash @ 80%',
      '  WHEN load > ~1000 req/s',
      'auth USES jwt',
      '  auth OWNED-BY platform-team'
    ].join('\n'))
    addCommand([file, '--db', db])

    // Two root claims; the WHEN qualifier and the grouped claim re-indent
    // under their parents and are part of those claims, not extra ones.
    const plain = exportCommand(['--db', db, '--out', join(dir, 'backup.cave')])
    assert.equal(plain.code, 0)
    assert.match(plain.out, /exported 2 claim\(s\) to /)

    // §28.4 transaction annotations are not claims either.
    const annotated = exportCommand(['--db', db, '--tx', '--out', join(dir, 'backup.tx.cave')])
    assert.equal(annotated.code, 0)
    assert.match(annotated.out, /exported 2 claim\(s\) to /)
  })
})

test('highlight renders ANSI colors from the grammar query', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-'))
  try {
    const file = join(dir, 'notes.cave')
    const text = 'auth USES jwt @ 90% #security ; note\nrevenue IS 20B -> 40B USD/yr\n'
    writeFileSync(file, text)
    const result = await highlightCommand([file])
    assert.equal(result.code, 0)
    assert.match(result.out, /\u001B\[[0-9;]+mUSES\u001B\[0m/u)
    assert.match(result.out, /\u001B\[[0-9;]+m->\u001B\[0m/u)
    assert.match(result.out, /\u001B\[[0-9;]+m; note\u001B\[0m/u)
    assert.equal(result.out.replaceAll(/\u001B\[[0-9;]*m/gu, ''), text)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check reports violations with exit 1 and satisfied shapes with exit 0 (spec §20.2)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      'service EXPECTS owner',
      'microservice EXTENDS service',
      'api IS microservice',
      'jan HAS birth-year: 1931 @ 40%'
    ].join('\n'))
    assert.equal(addCommand(['--db', db, file]).code, 0)
    const failing = checkCommand(['--db', db])
    assert.equal(failing.code, 1)
    assert.match(failing.out, /violations \(1\):/)
    assert.match(failing.out, /api missing attribute owner \(api IS microservice; service EXPECTS owner\)/)
    assert.match(failing.out, /review candidates \(1, conf 0.3-0.7\):/)
    assert.match(failing.out, /coverage: /)
    writeFileSync(file, 'api HAS owner: platform-team\n')
    assert.equal(addCommand(['--db', db, file]).code, 0)
    const passing = checkCommand(['--db', db])
    assert.equal(passing.code, 0)
    assert.match(passing.out, /shape: 1 expectation\(s\), 1 instance\(s\), 1\/1 satisfied/)
    assert.doesNotMatch(passing.out, /violations/)
  })
})

test('check explains cardinality and unit violations with observed values (spec §20.2)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      'service EXPECTS USES #cardinality:one',
      'service EXPECTS latency #unit:ms',
      'api IS service',
      'api USES postgres',
      'api USES redis',
      'api HAS latency: 1s'
    ].join('\n'))
    assert.equal(addCommand(['--db', db, file]).code, 0)
    const result = checkCommand(['--db', db])
    assert.equal(result.code, 1)
    assert.match(result.out, /api has 2 relations USES; expected exactly one/)
    assert.match(result.out, /api attribute latency has unit s; expected ms/)
  })
})

test('suggest-alias prints suggested claims that cave add accepts (spec §27)', () =>
  withDirAsync(async dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      'jan PARENT-OF maria',
      'maria PARENT-OF anna',
      'grandma-maria HAS age: 90 yr'
    ].join('\n'))
    assert.equal(addCommand(['--db', db, file]).code, 0)
    const result = await suggestAliasCommand(['--db', db])
    assert.equal(result.code, 0, result.err)
    assert.match(result.out, /^grandma-maria ALIAS maria #suggested @ \d+% ; /)
    // The printed text is ordinary CAVE — the review loop is a pipe.
    const suggested = join(dir, 'suggested.cave')
    writeFileSync(suggested, result.out)
    assert.equal(addCommand(['--db', db, suggested]).code, 0)
    // Decided now — nothing further to suggest.
    const settled = await suggestAliasCommand(['--db', db])
    assert.match(settled.out, /no alias suggestions/)
  }))

test('suggest-alias --write appends with @src:suggest/alias; --json carries signals (spec §27.3)', () =>
  withDirAsync(async dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, 'billing USES postgres\nanalytics USES postgresql\n')
    assert.equal(addCommand(['--db', db, file]).code, 0)
    const json = JSON.parse((await suggestAliasCommand(['--db', db, '--json'])).out)
    assert.equal(json.length, 1)
    assert.ok(json[0].signals.some((signal: { kind: string }) => signal.kind === 'prefix'))
    const written = await suggestAliasCommand(['--db', db, '--write'])
    assert.equal(written.code, 0, written.err)
    assert.match(written.out, /appended 1 suggested alias claim\(s\)/)
    const store = open(db)
    const rows = store.byTag('suggested')
    assert.equal(rows.length, 1)
    assert.ok(store.toClaim(rows[0]!).contexts.includes('src:suggest/alias'))
    store.close()
    // Idempotent by construction: the written pair has ALIAS history.
    const again = await suggestAliasCommand(['--db', db, '--write'])
    assert.match(again.out, /no alias suggestions/)
  }))

test('suggest-alias --write --json performs the write and reports its count', () =>
  withDirAsync(async dir => {
    const db = join(dir, 'k.db')
    const store = open(db)
    try { store.ingest('maria EXISTS\ngrandma-maria EXISTS') } finally { store.close() }
    const written = await suggestAliasCommand(['--db', db, '--write', '--json'])
    assert.equal(written.code, 0, written.err)
    const result = JSON.parse(written.out)
    assert.equal(result.appended, 1)
    assert.equal(result.suggestions.length, 1)
    const reopened = open(db)
    try { assert.equal(reopened.byTag('suggested').length, 1) } finally { reopened.close() }
    const again = JSON.parse((await suggestAliasCommand(['--db', db, '--write', '--json'])).out)
    assert.deepEqual(again, { suggestions: [], appended: 0 })
  }))

test('suggest-alias --agent does not write confirmations hidden inside JSON strings or objects', () =>
  withDirAsync(async dir => {
    const db = join(dir, 'k.db')
    const store = open(db)
    let before: string
    try {
      store.ingest('maria EXISTS\ngrandma-maria EXISTS')
      before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    } finally { store.close() }
    for (const agent of [
      `node -e 'console.log(JSON.stringify(["[1]"]))'`,
      `node -e 'console.log(JSON.stringify("[1]"))'`,
      `node -e 'console.log(JSON.stringify({rejected:[1]}))'`
    ]) {
      const result = await suggestAliasCommand(['--db', db, '--write', '--json', '--agent', agent])
      assert.equal(result.code, 0, result.err)
      assert.deepEqual(JSON.parse(result.out), { suggestions: [], appended: 0 })
      const reopened = open(db)
      try {
        assert.equal(reopened.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      } finally { reopened.close() }
    }
  }))

test('suggest-alias --agent judge filters; failures and bad flags fail cleanly (spec §27.4)', () =>
  withDirAsync(async dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      'maria EXISTS',
      'grandma-maria EXISTS',
      'long-street EXISTS',
      'Long_Street EXISTS'
    ].join('\n'))
    assert.equal(addCommand(['--db', db, file]).code, 0)
    const all = await suggestAliasCommand(['--db', db])
    assert.equal(all.out.trimEnd().split('\n').length, 2)
    // A judge confirming only S1 (the strongest — normalized equality).
    const confirmFirst = await suggestAliasCommand(['--db', db, '--agent', `node -e "console.log('[1]')"`])
    assert.equal(confirmFirst.code, 0, confirmFirst.err)
    const lines = confirmFirst.out.trimEnd().split('\n')
    assert.equal(lines.length, 1)
    assert.match(lines[0]!, /[Ll]ong[-_]/)
    const none = await suggestAliasCommand(['--db', db, '--agent', `node -e "console.log('[]')"`])
    assert.match(none.out, /no alias suggestions/)
    const failing = await suggestAliasCommand(['--db', db, '--agent', 'exit 5'])
    assert.equal(failing.code, 1)
    assert.match(failing.err, /agent exited with 5/)
    const badMin = await suggestAliasCommand(['--db', db, '--min', 'high'])
    assert.equal(badMin.code, 1)
    assert.match(badMin.err, /--min expects a score/)
    const badLimit = await suggestAliasCommand(['--db', db, '--limit', '0'])
    assert.equal(badLimit.code, 1)
    assert.match(badLimit.err, /--limit expects a positive safe integer/)
    const unsafeLimit = await suggestAliasCommand(['--db', db, '--limit', '9007199254740992'])
    assert.equal(unsafeLimit.code, 1)
    assert.match(unsafeLimit.err, /--limit expects a positive safe integer/)
    const help = await suggestAliasCommand(['--help'])
    assert.equal(help.code, 0)
    assert.match(help.out, /Usage:/)
  }))

test('check --json emits the full report; --stale validates (spec §20.2)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, 'auth USES jwt\n')
    assert.equal(addCommand(['--db', db, file]).code, 0)
    const report = JSON.parse(checkCommand(['--db', db, '--json']).out)
    assert.deepEqual(report.violations, [])
    assert.equal(report.coverage.rows, 1)
    assert.equal(checkCommand(['--db', db, '--stale', 'soon']).code, 1)
    assert.equal(checkCommand(['--db', db, '--stale', '0']).code, 0)
  })
})

test('check surfaces alias disagreements (spec §20.2)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const file = join(dir, 'k.cave')
    writeFileSync(file, [
      'postgres ALIAS postgresql',
      'postgres HAS version: 14',
      'postgresql HAS version: 15'
    ].join('\n'))
    assert.equal(addCommand(['--db', db, file]).code, 0)
    const result = checkCommand(['--db', db])
    assert.equal(result.code, 0, 'disagreements are advisory')
    assert.match(result.out, /alias disagreements \(1\):/)
    assert.match(result.out, /HAS version across postgres, postgresql:/)
  })
})

test('add --check rolls back appends that introduce violations (spec §20.3)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const shapes = join(dir, 'shapes.cave')
    writeFileSync(shapes, 'service EXPECTS owner\n')
    assert.equal(addCommand(['--db', db, shapes]).code, 0)
    const bad = join(dir, 'bad.cave')
    writeFileSync(bad, 'api IS service\n')
    const rejected = addCommand(['--db', db, '--check', bad])
    assert.equal(rejected.code, 1)
    assert.match(rejected.err, /rejected: 1 new violation\(s\), nothing added/)
    assert.match(rejected.err, /api missing attribute owner/)
    const store = open(db)
    assert.equal(store.claimsAbout('api').length, 0)
    store.close()
    const good = join(dir, 'good.cave')
    writeFileSync(good, 'api IS service\napi HAS owner: platform-team\n')
    const accepted = addCommand(['--db', db, '--check', good])
    assert.equal(accepted.code, 0)
    assert.match(accepted.out, /added 2 claim\(s\)/)
  })
})

test('act: declare + execute + list + retract (spec §25)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const actions = join(dir, 'actions.cave')
    writeFileSync(actions, [
      'action/mark-deployed HAS action: `?service, ?version, ?service IS service => ?service HAS deployed-version: ?version` ; record a deployment',
      'action/mark-deployed/service IS param ; the service that was deployed',
      'api IS service'
    ].join('\n'))
    const declared = actCommand(['--db', db, '--declare', actions])
    assert.equal(declared.code, 0, declared.err)
    assert.match(declared.out, /declared 1 action\(s\)/)

    const executed = actCommand(['--db', db, 'mark-deployed', 'service=api', 'version=1.2.3'])
    assert.equal(executed.code, 0, executed.err)
    assert.match(executed.out, /\+1 appended/)
    assert.match(executed.out, /appended: api HAS deployed-version: 1\.2\.3/)
    const queried = queryCommand(['--db', db, 'api HAS deployed-version: ?v'])
    assert.match(queried.out, /\?v = 1\.2\.3/)

    const listed = actCommand(['--db', db, '--list'])
    assert.match(listed.out, /action\/mark-deployed/)
    assert.match(listed.out, /\?service — the service that was deployed/)

    // A failed precondition appends nothing and exits 1.
    const failed = actCommand(['--db', db, 'mark-deployed', 'service=ghost', 'version=1'])
    assert.equal(failed.code, 1)
    assert.match(failed.err, /precondition failed/)

    const retracted = actCommand(['--db', db, '--retract', 'mark-deployed'])
    assert.equal(retracted.code, 0)
    const gone = actCommand(['--db', db, 'mark-deployed', 'service=api', 'version=2'])
    assert.equal(gone.code, 1)
    assert.match(gone.err, /no current action/)
    // Recorded effects survive the retraction (spec §25.1).
    assert.match(queryCommand(['--db', db, 'api HAS deployed-version: ?v']).out, /1\.2\.3/)
  })
})

test('act --dry-run persists nothing; act --json reports; bad pairs rejected', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const seed = join(dir, 'seed.cave')
    writeFileSync(seed, 'action/open-window HAS action: `=> maintenance-window EXISTS`\n')
    assert.equal(actCommand(['--db', db, '--declare', seed]).code, 0)

    const dry = actCommand(['--db', db, 'open-window', '--dry-run'])
    assert.equal(dry.code, 0, dry.err)
    assert.match(dry.out, /\(dry run\)/)
    assert.match(queryCommand(['--db', db, 'maintenance-window EXISTS']).out, /no matches/)

    const json = actCommand(['--db', db, 'open-window', '--json'])
    assert.equal(json.code, 0)
    const report = JSON.parse(json.out) as { ok: boolean, appended: number }
    assert.equal(report.ok, true)
    assert.equal(report.appended, 1)

    const bad = actCommand(['--db', db, 'open-window', 'not-a-pair'])
    assert.equal(bad.code, 1)
    assert.match(bad.err, /expected param=value/)
  })
})

test('malformed hook encoding is rejected consistently before action effects', () => {
  withDir(dir => {
    const db = join(dir, 'k.db'), seed = join(dir, 'seed.cave'), hooks = join(dir, 'hooks.json')
    writeFileSync(seed, 'action/note HAS action: `?x => ?x IS noted`\naction/note HAS hook: post')
    assert.equal(actCommand(['--db', db, '--declare', seed]).code, 0)
    const before = exportCommand(['--db', db, '--tx', '--max-sensitivity', 'restricted']).out
    for (const invalid of [
      Buffer.concat([Buffer.from('{"post":"exit 0 # '), Buffer.from([0xff]), Buffer.from('"}')]),
      Buffer.from(JSON.stringify({ post: 'exit 0 # \ud800' })),
      Buffer.from(JSON.stringify({ ['\udc00']: 'exit 0' })),
      Buffer.from(JSON.stringify({ ' ': 'exit 0' })),
    ]) {
      writeFileSync(hooks, invalid)
      const rejected = cave(['act', '--db', db, 'note', 'x=partial', '--hooks', hooks])
      assert.equal(rejected.code, 1)
      assert.equal(rejected.out, '')
      const doctor = doctorCommand(['--db', db, '--hooks', hooks, '--json'])
      const check = JSON.parse(doctor.out).checks.find((check: { id: string }) => check.id === 'config.hooks')
      assert.equal(check.status, 'fail')
      assert.equal(exportCommand(['--db', db, '--tx', '--max-sensitivity', 'restricted']).out, before)
    }
    writeFileSync(hooks, JSON.stringify({ post: 'exit 0' }))
    assert.equal(actCommand(['--db', db, 'note', 'x=recovered', '--hooks', hooks]).code, 0)
    assert.match(queryCommand(['--db', db, '?x IS noted']).out, /recovered/)
  })
})

test('act --hooks fires the named hook with claims on stdin (spec §25.4)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const seed = join(dir, 'seed.cave')
    const hooks = join(dir, 'hooks.json')
    const out = join(dir, 'hook-output.txt')
    writeFileSync(seed, [
      'action/announce HAS action: `?what => bulletin CONTAINS ?what`',
      'action/announce HAS hook: post'
    ].join('\n'))
    const script = 'const fs=require(\'fs\');fs.writeFileSync(process.argv[1],fs.readFileSync(0,\'utf8\'))'
    writeFileSync(hooks, JSON.stringify({ post: `node -e "${script}" ${out}` }))
    assert.equal(actCommand(['--db', db, '--declare', seed]).code, 0)

    const executed = actCommand(['--db', db, 'announce', 'what=launch', '--hooks', hooks])
    assert.equal(executed.code, 0, executed.err)
    assert.match(executed.out, /hook post: ok/)
    assert.match(readFileSync(out, 'utf8'), /bulletin CONTAINS launch/)

    // A named-but-unconfigured hook is a note, not an error (spec §25.4).
    const unconfigured = actCommand(['--db', db, 'announce', 'what=retro'])
    assert.equal(unconfigured.code, 0)
    assert.match(unconfigured.out, /hook post: not fired \(not configured\)/)

    // A failing hook keeps the claims and carries the exit code.
    writeFileSync(hooks, JSON.stringify({ post: 'node -e "process.exit(3)"' }))
    const failing = actCommand(['--db', db, 'announce', 'what=ga', '--hooks', hooks])
    assert.equal(failing.code, 1)
    assert.match(failing.out, /hook post: hook exited with 3/)
    assert.match(queryCommand(['--db', db, 'bulletin CONTAINS ?w']).out, /ga/)

    const snapshot = () => {
      const store = open(db, { access: 'read-only' })
      try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) }
      finally { store.close() }
    }
    const committed = snapshot()
    const previousHookOutput = readFileSync(out, 'utf8')
    writeFileSync(hooks, JSON.stringify({ post: `node -e "${script}" ${out}` }))
    const repeated = actCommand(['--db', db, 'announce', 'what=ga', '--hooks', hooks])
    assert.equal(repeated.code, 0, repeated.err)
    assert.match(repeated.out, /hook post: not fired \(nothing changed\)/)
    assert.equal(snapshot(), committed)
    assert.equal(readFileSync(out, 'utf8'), previousHookOutput, 'a no-op does not retry the corrected hook')

    const changed = actCommand(['--db', db, 'announce', 'what=release', '--hooks', hooks])
    assert.equal(changed.code, 0, changed.err)
    assert.match(changed.out, /hook post: ok/)
    assert.match(readFileSync(out, 'utf8'), /bulletin CONTAINS release/)
    assert.match(queryCommand(['--db', db, 'bulletin CONTAINS ?w']).out, /ga/)
  })
})

test('act --no-check skips the shape gate; the gate rejects by default (spec §25.3)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const seed = join(dir, 'seed.cave')
    writeFileSync(seed, [
      'service EXPECTS owner',
      'action/enroll HAS action: `?name => ?name IS service`'
    ].join('\n'))
    assert.equal(actCommand(['--db', db, '--declare', seed]).code, 0)

    const rejectedRun = actCommand(['--db', db, 'enroll', 'name=cache'])
    assert.equal(rejectedRun.code, 1)
    assert.match(rejectedRun.err, /shape gate/)
    assert.match(rejectedRun.err, /cache missing attribute owner/)
    assert.match(queryCommand(['--db', db, 'cache IS service']).out, /no matches/)

    const unchecked = actCommand(['--db', db, 'enroll', 'name=cache', '--no-check'])
    assert.equal(unchecked.code, 0, unchecked.err)
    assert.match(queryCommand(['--db', db, 'cache IS service']).out, /cache IS service/)
  })
})

test('sync merges a store file, idempotently, and records the merge (spec §28)', () => {
  withDir(dir => {
    const a = join(dir, 'main.db')
    const b = join(dir, 'laptop.db')
    writeFileSync(join(dir, 'b.cave'), 'billing USES postgres @ 90%\n')
    assert.equal(addCommand(['--db', b, join(dir, 'b.cave')]).code, 0)

    const first = syncCommand(['--db', a, b])
    assert.equal(first.code, 0, first.err)
    assert.match(first.out, /merged 1 claim\(s\), 0 edge\(s\)/)
    assert.match(first.out, /record: store\/laptop SYNCED-INTO store\/main/)
    assert.match(queryCommand(['--db', a, 'billing USES postgres']).out, /billing USES postgres/)

    const again = syncCommand(['--db', a, b])
    assert.equal(again.code, 0)
    assert.match(again.out, /merged 0 claim\(s\), 0 edge\(s\), 1 already present/)
    assert.doesNotMatch(again.out, /record:/)
  })
})

test('sync reports database identity conflicts in text and JSON without copying', () => {
  withDir(dir => {
    const a = join(dir, 'a.db')
    const b = join(dir, 'b.db')
    const source = open(b)
    source.ingest('api IS trusted')
    source.close()
    assert.equal(syncCommand(['--db', a, b, '--no-record']).code, 0)
    const changed = open(b)
    changed.db.exec("UPDATE cave_claim SET object = 'compromised' WHERE subject = 'api'")
    changed.ingest('request IS denied')
    changed.close()
    for (const extra of [[], ['--dry-run'], ['--json'], ['--dry-run', '--json']]) {
      const result = syncCommand(['--db', a, b, ...extra])
      assert.equal(result.code, 1)
      if (extra.includes('--json')) {
        const report = JSON.parse(result.out)
        assert.equal(report.merged, 0)
        assert.equal(report.problems[0].line, 0)
        assert.match(report.problems[0].message, /already stored.*different content/)
      } else {
        assert.match(result.err, /nothing merged/)
        assert.match(result.err, /already stored.*different content/)
        assert.doesNotMatch(result.err, /line 0/)
      }
    }
    assert.match(queryCommand(['--db', a, 'request IS denied']).out, /no matches/)
  })
})

test('sync treats a hard-linked source as the target without changing its rows', () => {
  withDir(dir => {
    const db = join(dir, 'store.db')
    const alias = join(dir, 'alias.db')
    const store = open(db)
    store.ingest('api IS service')
    store.close()
    linkSync(db, alias)
    const before = readFileSync(db)
    for (const dryRun of [false, true]) {
      const result = syncCommand(['--db', db, alias, '--json', ...(dryRun ? ['--dry-run'] : [])])
      assert.equal(result.code, 0, result.err)
      const report = JSON.parse(result.out)
      assert.equal(report.merged, 0)
      assert.equal(report.dryRun, dryRun)
      assert.deepEqual(report.problems, [])
      assert.deepEqual(readFileSync(db), before)
    }
  })
})

test('sync --dry-run reports without writing; --json is machine-readable', () => {
  withDir(dir => {
    const a = join(dir, 'a.db')
    const b = join(dir, 'b.db')
    writeFileSync(join(dir, 'a.cave'), 'a IS target\n')
    assert.equal(addCommand(['--db', a, join(dir, 'a.cave')]).code, 0)
    writeFileSync(join(dir, 'b.cave'), 'x NEEDS y\n')
    assert.equal(addCommand(['--db', b, join(dir, 'b.cave')]).code, 0)

    // A dry run only reads, so the target must already exist (spec §13.7).
    const dry = syncCommand(['--db', a, b, '--dry-run', '--json'])
    assert.equal(dry.code, 0)
    const report = JSON.parse(dry.out)
    assert.equal(report.merged, 1)
    assert.equal(report.dryRun, true)
    assert.match(queryCommand(['--db', a, 'x NEEDS y']).out, /no matches/)
  })
})

test('sync consumes cave export --tx text and validates plain text (spec §28.4)', () => {
  withDir(dir => {
    const a = join(dir, 'a.db')
    const b = join(dir, 'b.db')
    const notes = join(dir, 'notes.cave')
    writeFileSync(notes, 'deploy CAUSE outage @ 70%\n  BECAUSE logs\n')
    assert.equal(addCommand(['--db', a, notes]).code, 0)

    const annotated = join(dir, 'a.tx.cave')
    const exported = exportCommand(['--db', a, '--tx', '--out', annotated])
    assert.equal(exported.code, 0)
    assert.match(exported.out, /exported 1 claim\(s\)/, 'neither annotations nor the BECAUSE qualifier count as claims')
    assert.match(readFileSync(annotated, 'utf8'), /^;@ [0-9a-f-]{36}\n/)

    const synced = syncCommand(['--db', b, annotated, '--as', 'a', '--into', 'b'])
    assert.equal(synced.code, 0, synced.err)
    assert.match(synced.out, /merged 2 claim\(s\), 1 edge\(s\)/)
    assert.match(synced.out, /record: store\/a SYNCED-INTO store\/b/)
    assert.equal(syncCommand(['--db', b, annotated]).code, 0)

    // Plain canonical text carries no identity — sync refuses, pointing at import.
    const plain = syncCommand(['--db', b, notes])
    assert.equal(plain.code, 1)
    assert.match(plain.err, /without a transaction annotation/)
    assert.match(plain.err, /cave import/)
  })
})

test('sync JSON distinguishes rejected content from source errors and recovers without partial writes', () => {
  withDir(dir => {
    const db = join(dir, 'target.db'), path = join(dir, 'source.cave')
    const source = open(), target = open(db)
    let valid: string, before: string
    try {
      source.ingest('remote IS imported')
      target.ingest('local IS retained')
      valid = source.exportText({ tx: true, maxSensitivity: 'restricted' })
      before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
    } finally { source.close(); target.close() }
    const unchanged = () => {
      const store = open(db)
      try { assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before) }
      finally { store.close() }
    }
    for (const dryRun of [false, true]) {
      const args = ['--db', db, path, '--json', '--no-prelude', ...(dryRun ? ['--dry-run'] : [])]
      for (const text of ['unannotated IS rejected', ';@ invalid\nremote IS imported']) {
        writeFileSync(path, text)
        const result = syncCommand(args)
        assert.equal(result.code, 1)
        assert.equal(result.err, '')
        const report = JSON.parse(result.out)
        assert.ok(report.problems.length > 0)
        assert.equal(report.merged, 0)
        assert.equal(report.record, undefined)
        assert.equal(report.dryRun, dryRun)
        unchanged()
      }
      for (const bytes of [Buffer.from([0xff]), Buffer.from('SQLite format 3\0broken')]) {
        writeFileSync(path, bytes)
        const result = syncCommand(args)
        assert.equal(result.code, 1)
        assert.equal(result.out, '')
        assert.ok(result.err.includes(path))
        assert.match(result.err, bytes[0] === 0xff ? /invalid UTF-8/ : /cannot (attach|inspect) sync source/)
        unchanged()
      }
      rmSync(path)
      const missing = syncCommand(args)
      assert.equal(missing.code, 1)
      assert.equal(missing.out, '')
      assert.match(missing.err, /no such file/)
      unchanged()
    }
    writeFileSync(path, valid!)
    const args = ['--db', db, path, '--json', '--no-prelude']
    const preview = syncCommand([...args, '--dry-run'])
    assert.equal(preview.code, 0, preview.err)
    assert.equal(JSON.parse(preview.out).merged, 1)
    unchanged()
    const merged = syncCommand(args)
    assert.equal(merged.code, 0, merged.err)
    assert.equal(JSON.parse(merged.out).merged, 1)
    assert.equal(JSON.parse(syncCommand(args).out).merged, 0)
  })
})

test('sync validates its arguments and sources', () => {
  withDir(dir => {
    const a = join(dir, 'a.db')
    assert.match(syncCommand(['--db', a]).err, /exactly one source/)
    assert.match(syncCommand(['--db', a, 'missing.db']).err, /no such file/)
    assert.match(commandHelp['sync']!, /row identity/)
    assert.match(cave(['sync', '--help']).out, /merge/)
  })
})

test('report renders cited markdown from a template (spec §31)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const claims = join(dir, 'k.cave')
    writeFileSync(claims, [
      'api-gateway IS service',
      'checkout IS service',
      'api-gateway HAS owner: platform-team',
      'checkout HAS owner: payments-team',
      'checkout HAS owner: shop-team @src:audit',
      'acme HAS revenue: ~20B USD/yr @ 90%'
    ].join('\n'))
    assert.equal(addCommand([claims, '--db', db]).code, 0) // stamps @src:cli

    const template = join(dir, 'weekly.md')
    writeFileSync(template, [
      '# Weekly',
      '',
      'Revenue: `cave-q: acme HAS revenue: ?v`.',
      '',
      '```cave-q',
      '?svc HAS owner: ?who @src:cli',
      '- **?svc** — ?who [^?]',
      '```'
    ].join('\n'))

    const rendered = reportCommand([template, '--db', db])
    assert.equal(rendered.code, 0, rendered.err)
    assert.match(rendered.out, /Revenue: ~20B USD\/yr\[\^c1\]\./)
    assert.match(rendered.out, /- \*\*api-gateway\*\* — platform-team \[\^c2\]/)
    assert.match(rendered.out, /- \*\*checkout\*\* — payments-team \[\^c3\]/)
    // Citations carry the canonical line (stamp visible), date and claim key.
    assert.match(rendered.out, /\[\^c1\]: `acme HAS revenue: ~20B USD\/yr @src:cli @ 90%` — \d{4}-\d{2}-\d{2}, claim key `\[/)

    // A contested fact is ambiguous inline; --resolve renders the §26 winner.
    const inline = join(dir, 'owner.md')
    writeFileSync(inline, 'Owner: `cave-q: checkout HAS owner: ?who`\n')
    const ambiguous = reportCommand([inline, '--db', db])
    assert.equal(ambiguous.code, 1)
    assert.match(ambiguous.err, /template line 1: ambiguous.*--resolve/s)
    assert.match(ambiguous.out, /\*\(ambiguous: 2 matches\)\*/)
    const resolved = reportCommand([inline, '--db', db, '--resolve'])
    assert.equal(resolved.code, 0, resolved.err)
    assert.match(resolved.out, /Owner: payments-team\[\^c1\]/)

    // --out writes the file and reports the citation count.
    const out = join(dir, 'report.md')
    const written = reportCommand([template, '--db', db, '--out', out])
    assert.equal(written.code, 0)
    assert.match(written.out, /rendered 3 citation\(s\) to /)
    assert.match(readFileSync(out, 'utf8'), /\[\^c3\]:/)
    assert.match(commandHelp['report']!, /claim key/)
  })
})

test('report uses the shared sensitivity ceiling and validates labels (spec §9.7)', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const claims = join(dir, 'k.cave')
    const template = join(dir, 'report.md')
    writeFileSync(claims, [
      'public-item HAS status: ready #sensitivity:public',
      'internal-item HAS status: ready',
      'secret-item HAS status: ready #sensitivity:confidential'
    ].join('\n'))
    writeFileSync(template, '```cave-q\n?item HAS status: ?status\n- ?item: ?status [^?]\n```\n')
    assert.equal(addCommand([claims, '--db', db]).code, 0)

    const ordinary = reportCommand([template, '--db', db])
    assert.equal(ordinary.code, 0, ordinary.err)
    assert.match(ordinary.out, /public-item|internal-item/)
    assert.doesNotMatch(ordinary.out, /secret-item/)

    const complete = reportCommand([template, '--db', db, '--max-sensitivity', 'confidential'])
    assert.equal(complete.code, 0, complete.err)
    assert.match(complete.out, /secret-item/)

    const invalid = reportCommand([template, '--db', db, '--max-sensitivity', 'secret'])
    assert.equal(invalid.code, 1)
    assert.match(invalid.err, /public, internal, confidential, restricted/)
  })
})

test('a CAVE text file is a store for read commands (spec §13.7)', () => {
  withDir(dir => {
    const file = join(dir, 'repos.cave')
    writeFileSync(file, 'cave IS repo\ncave HAS stars: 12 @src:readme\n')
    const queried = cave(['query', '--db', file, '?repo IS repo'])
    assert.equal(queried.code, 0)
    assert.equal(queried.out, '?repo = cave\n')
    const exported = cave(['export', '--db', file])
    assert.match(exported.out, /HAS stars: 12 @src:readme/, 'authored provenance survives')
    assert.doesNotMatch(exported.out, /src:cli/, 'no actor stamp — cave import semantics')
    const searched = cave(['search', '--db', file, 'stars'])
    assert.match(searched.out, /cave HAS stars: 12/)
    assert.equal(cave(['check', '--db', file]).code, 0)
    assert.equal(readFileSync(file, 'utf8'), 'cave IS repo\ncave HAS stars: 12 @src:readme\n', 'the file is untouched')
  })
})

test('text stores are read-only and unparsable text fails the load', () => {
  withDir(dir => {
    const file = join(dir, 'repos.cave')
    writeFileSync(file, 'cave IS repo\n')
    const added = cave(['add', '--db', file, join(dir, 'repos.cave')])
    assert.equal(added.code, 1)
    assert.match(added.err, /repos\.cave is CAVE text, not a database — text stores are read-only; materialize it with `cave import --db <store\.db> .*repos\.cave`/)
    assert.equal(readFileSync(file, 'utf8'), 'cave IS repo\n')

    const bad = join(dir, 'bad.cave')
    writeFileSync(bad, 'cave IS repo\nthis is not\n')
    const loaded = cave(['query', '--db', bad, '?x IS ?y'])
    assert.equal(loaded.code, 1)
    assert.match(loaded.err, /cannot load .*bad\.cave as a store/)
    assert.match(loaded.err, /bad\.cave line 2: /)
  })
})

test('read commands never create a database at a missing path', () => {
  withDir(dir => {
    const missing = join(dir, 'typo.db')
    const template = join(dir, 'report.md')
    writeFileSync(template, '# nothing\n')
    for (const argv of [
      ['query', '?x IS ?y'], ['search', 'x'], ['resolve'], ['check'], ['export'], ['report', template], ['generate'],
      ['derive', '--list'], ['act', '--list'], ['sync', '--dry-run', missing]
    ]) {
      const [command, ...rest] = argv
      const result = cave([command!, '--db', missing, ...rest])
      assert.equal(result.code, 1, `${command} must fail`)
      assert.match(result.err, /no store at .*typo\.db — create one with `cave add --db .*typo\.db`, or pass a CAVE text file/, command)
      assert.equal(existsSync(missing), false, `${command} must not create the database`)
    }
    const seed = join(dir, 'seed.cave')
    writeFileSync(seed, 'cave IS repo\n')
    const created = cave(['add', '--db', missing, '--no-src', seed])
    assert.equal(created.code, 0, created.err)
    assert.equal(existsSync(missing), true, 'add still initializes a missing store')
  })
})

test('read commands never migrate an older store; a writing command does (spec §13.7)', () => {
  withDir(dir => {
    const db = join(dir, 'legacy.db')
    const legacy = open(db)
    legacy.ingest('a IS b')
    legacy.db.exec('PRAGMA user_version = 0')
    legacy.close()
    const versionOf = (): number => {
      const raw = new DatabaseSync(db, { readOnly: true })
      try {
        return Schema.versionOf(raw)
      } finally {
        raw.close()
      }
    }
    const read = cave(['query', '--db', db, '?x IS ?y'])
    assert.equal(read.code, 1)
    assert.match(read.err, /^cave query: .*legacy\.db: schema version 0 needs migration to 2 — close every user and copy the file as a rollback point, then open it with a writing command such as cave add/)
    assert.equal(versionOf(), 0, 'the read left the schema version alone')
    const dry = cave(['derive', '--db', db, '--dry-run'])
    assert.equal(dry.code, 1)
    assert.equal(versionOf(), 0, 'a dry run left the schema version alone')
    const seed = join(dir, 'seed.cave')
    writeFileSync(seed, 'c IS d\n')
    assert.equal(cave(['add', '--db', db, seed]).code, 0)
    assert.equal(versionOf(), Schema.currentVersion, 'a writing command migrates')
  })
})

test('backup refuses to snapshot a text store onto itself', () => {
  withDir(dir => {
    const file = join(dir, 'repos.cave')
    writeFileSync(file, 'cave IS repo\n')
    const aliased = cave(['backup', '--db', file, '--out', file, '--force'])
    assert.equal(aliased.code, 1)
    assert.match(aliased.err, /is the source database — refusing to overwrite it/)
    assert.equal(readFileSync(file, 'utf8'), 'cave IS repo\n', 'the text file survives')
    const snapshot = join(dir, 'repos.db')
    const created = cave(['backup', '--db', file, '--out', snapshot])
    assert.equal(created.code, 0, created.err)
    assert.equal(cave(['query', '--db', snapshot, '?x IS repo']).out, '?x = cave\n', 'a snapshot elsewhere materializes the text store')
  })
})

test('backup of a store awaiting migration names the file-copy rollback point instead of migrating', () => {
  withDir(dir => {
    const db = join(dir, 'legacy.db')
    const legacy = open(db)
    legacy.ingest('a IS b')
    legacy.db.exec('PRAGMA user_version = 0')
    legacy.close()
    const bytes = readFileSync(db)
    const result = cave(['backup', '--db', db, '--out', join(dir, 'snap.db')])
    assert.equal(result.code, 1)
    assert.match(result.err, /schema version 0 needs migration to 2 — close every user and copy the file as a rollback point/)
    assert.deepEqual(readFileSync(db), bytes, 'the source is neither migrated nor touched')
    assert.equal(existsSync(join(dir, 'snap.db')), false)
  })
})

test('report, export, and generate refuse --out that aliases a text store', () => {
  withDir(dir => {
    const file = join(dir, 'repos.cave')
    writeFileSync(file, 'cave IS repo\n')
    const template = join(dir, 'report.md')
    writeFileSync(template, '# repos\n')
    for (const argv of [['report', template], ['export'], ['generate']]) {
      const [command, ...rest] = argv
      const result = cave([command!, '--db', file, '--out', file, ...rest])
      assert.equal(result.code, 1, command)
      assert.match(result.err, /is the source database — refusing to overwrite it/, command)
    }
    assert.equal(readFileSync(file, 'utf8'), 'cave IS repo\n', 'the text store survives')
  })
})

test('act --declare wins over --list and still opens the store for writing', () => {
  withDir(dir => {
    const db = join(dir, 'k.db')
    const actions = join(dir, 'actions.cave')
    writeFileSync(actions, 'action/note HAS action: `?x => ?x IS noted` ; note a thing\n')
    const declared = cave(['act', '--db', db, '--declare', actions, '--list'])
    assert.equal(declared.code, 0, declared.err)
    assert.match(declared.out, /declared 1 action\(s\)/)
    const listed = cave(['act', '--db', db, '--list'])
    assert.match(listed.out, /note/)
  })
})

test('a text store follows its declared sources and query --sources overlays them on a SQLite store (spec §23.4)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-'))
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name,company\n1,ann,acme\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n?name WORKS-AT ?company\n')
    const notes = join(dir, 'notes.cave')
    writeFileSync(notes, 'acme IS company\nsource/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id\n')
    assert.equal(cave(['query', '--db', notes, '?who WORKS-AT acme']).out, '?who = ann\n')
    assert.match(cave(['export', '--db', notes]).out, /WORKS-AT acme @src:people\.csv#L2 @src:people\/1/)

    const db = join(dir, 'k.db')
    assert.equal(cave(['import', '--db', db, notes]).code, 0)
    assert.equal(cave(['query', '--db', db, '?who WORKS-AT acme']).out, 'no matches\n')
    assert.equal((await querySourcesCommand(['--db', db, '?who WORKS-AT acme', '--sources'])).out, '?who = ann\n')
    assert.equal(cave(['query', '--db', db, '?who WORKS-AT acme']).out, 'no matches\n', 'the overlay rolled back')
    const paged = await querySourcesCommand(['--db', db, '?who WORKS-AT acme', '--sources', '--cursor', 'x'])
    assert.equal(paged.code, 1)
    assert.match(paged.err, /--cursor does not apply to --sources/)
    const synchronous = cave(['query', '--db', db, '?who WORKS-AT acme', '--sources'])
    assert.equal(synchronous.code, 1)
    assert.match(synchronous.err, /runs asynchronously — use querySourcesCommand/)
    assert.equal((await querySourcesCommand(['--db', db, '?who WORKS-AT acme'])).out, 'no matches\n', 'without --sources it is the plain query')
    assert.equal((await querySourcesCommand(['--db', notes, '?who WORKS-AT acme', '--sources'])).out, '?who = ann\n', 'a text store is queried as assembled')

    const broken = join(dir, 'broken.cave')
    writeFileSync(broken, 'source/people HAS path: nope.csv\nsource/people HAS map: people.map.cave\n')
    const failed = cave(['query', '--db', broken, '?x IS ?y'])
    assert.equal(failed.code, 1)
    assert.match(failed.err, /^cave query: source\/people \(nope\.csv\): /)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('doctor recognizes a CAVE text store and its declared sources', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n')
    const notes = join(dir, 'notes.cave')
    writeFileSync(notes, 'acme IS company\nsource/people HAS path: people.csv\nsource/people HAS map: people.map.cave\n')
    const report = JSON.parse(doctorCommand(['--db', notes, '--json']).out)
    assert.equal(report.configuration.database.kind, 'text')
    assert.equal(report.configuration.database.claims, 6, 'the root claim, the two declaration claims, the mapped record, its digest, and the declaration the run recorded')
    assert.match(report.checks.find((entry: { id: string }) => entry.id === 'store.database').summary, /text store assembled in memory/)
    writeFileSync(notes, 'source/people HAS path: nope.csv\nsource/people HAS map: people.map.cave\n')
    const broken = JSON.parse(doctorCommand(['--db', notes, '--json']).out)
    assert.equal(broken.checks.find((entry: { id: string }) => entry.id === 'store.database').status, 'fail')
  })
})

test('backup of a text store snapshots the assembled store, declared sources included', () => {
  withDir(dir => {
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n')
    const notes = join(dir, 'notes.cave')
    writeFileSync(notes, 'acme IS company\nsource/people HAS path: people.csv\nsource/people HAS map: people.map.cave\n')
    const snapshot = join(dir, 'notes.db')
    assert.equal(cave(['backup', '--db', notes, '--out', snapshot]).code, 0)
    assert.equal(cave(['query', '--db', snapshot, '?who IS person']).out, '?who = ann\n')
  })
})

test('query --sources answers the overlay whole and fetches a text store\'s URL sources', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-'))
  try {
    const rows = Array.from({ length: 150 }, (_, i) => `${i + 1},p${i + 1}`)
    writeFileSync(join(dir, 'people.csv'), `id,name\n${rows.join('\n')}\n`)
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n')
    const db = join(dir, 'k.db')
    const store = open(db)
    store.ingest('source/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id')
    store.close()
    const whole = await querySourcesCommand(['--db', db, '?who IS person', '--sources', '--limit', '50'])
    assert.equal(whole.code, 0, whole.err)
    assert.equal(whole.out.trim().split('\n').length, 150, 'every match, not one page')
    assert.doesNotMatch(whole.out, /^next: /m)
    const json = JSON.parse((await querySourcesCommand(['--db', db, '?who IS person', '--sources', '--json'])).out)
    assert.equal(json.matches.length, 150)
    assert.equal('next' in json, false)

    const notes = join(dir, 'notes.cave')
    writeFileSync(notes, 'source/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/remote HAS path: https://example.test/remote.cave\n')
    const fetched: string[] = []
    const fetchImpl = async (url: string): Promise<Response> => {
      fetched.push(url)
      return new Response('remote IS thing\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    assert.equal(cave(['query', '--db', notes, 'remote IS ?what']).out, 'no matches\n', 'assembly skips the URL source')
    const overlaid = await querySourcesCommand(['--db', notes, 'remote IS ?what', '--sources'], { fetchImpl })
    assert.equal(overlaid.out, '?what = thing\n', 'the overlay fetches what assembly could not follow')
    assert.deepEqual(fetched, ['https://example.test/remote.cave'], 'and only that — the local source was already followed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('query --sources rediscovers when a writer changes the declarations while sources load', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cli-'))
  try {
    const db = join(dir, 'k.db')
    const store = open(db)
    store.ingest('source/remote HAS path: https://example.test/a.cave')
    store.close()
    const fetched: string[] = []
    let first = true
    const fetchImpl = async (url: string): Promise<Response> => {
      fetched.push(url)
      if (first) {
        first = false
        // A writer moves the declaration while the first load is in flight.
        const writer = open(db)
        writer.ingest('source/remote HAS path: https://example.test/b.cave')
        writer.close()
      }
      return new Response(url.endsWith('a.cave') ? 'answer IS a\n' : 'answer IS b\n', { status: 200 })
    }
    const result = await querySourcesCommand(['--db', db, 'answer IS ?x', '--sources'], { fetchImpl })
    assert.equal(result.code, 0, result.err)
    assert.equal(result.out, '?x = b\n', 'the overlay answers from the declaration current at replay')
    assert.deepEqual(fetched, ['https://example.test/a.cave', 'https://example.test/b.cave'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('suggest-alias --write reports unrepresentable pairs without claiming successful appends', () =>
  withDirAsync(async dir => {
    const db = join(dir, 'k.db')
    const store = open(db)
    let before: string
    try {
      store.ingest('42 HAS email: "shared@example.test"\n43 HAS email: "shared@example.test"\nmaria EXISTS\ngrandma-maria EXISTS')
      before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    } finally { store.close() }
    for (const flags of [[], ['--json']]) {
      const result = await suggestAliasCommand(['--db', db, '--write', ...flags])
      assert.equal(result.code, 1)
      assert.equal(result.out, '')
      assert.match(result.err, /cannot represent an alias relation/i)
      const reopened = open(db)
      try { assert.equal(reopened.exportText({ tx: true, maxSensitivity: 'restricted' }), before) }
      finally { reopened.close() }
    }
  }))

test('suggest-alias --limit excludes unsupported lower-ranked pairs from the write', () =>
  withDirAsync(async dir => {
    const db = join(dir, 'k.db')
    const store = open(db)
    try { store.ingest('Long_Street EXISTS\nlong-street EXISTS\n42 HAS email: "shared@example.test"\n43 HAS email: "shared@example.test"') }
    finally { store.close() }
    const result = await suggestAliasCommand(['--db', db, '--limit', '1', '--write', '--json'])
    assert.equal(result.code, 0, result.err)
    const written = JSON.parse(result.out)
    assert.equal(written.appended, 1)
    assert.equal(written.suggestions.length, 1)
    const reopened = open(db)
    try {
      assert.ok(reopened.aliasesOf('Long_Street').includes('long-street'))
      assert.deepEqual(reopened.aliasesOf('42'), ['42'])
    } finally { reopened.close() }
  }))

test('check confidence summaries preserve the endpoints without changing JSON precision', () => {
  withDir(dir => {
    for (const [index, [authored, value, label]] of [
      ['0.001%', 0.00001, '<1%'], ['99.999%', 0.99999, '>99%'],
      ['50%', 0.5, '50%'], ['100%', 1, '100%'], ['0%', null, undefined]
    ].entries()) {
      const db = join(dir, `confidence-${index}.db`)
      const store = open(db)
      try { store.ingest(`sensor IS available @ ${authored}`) } finally { store.close() }
      const text = checkCommand(['--db', db])
      assert.equal(text.code, 0)
      if (label === undefined) assert.doesNotMatch(text.out, /avg conf/)
      else assert.ok(text.out.includes(`avg conf ${label},`), text.out)
      const json = checkCommand(['--db', db, '--json'])
      assert.equal(json.code, 0)
      assert.equal(JSON.parse(json.out).coverage.averageConfidence, value)
    }
  })
})


test('act rejects repeated and prototype-named extra arguments before effects', () => {
  withDir(dir => {
    const db = join(dir, 'k.db'), seed = join(dir, 'action.cave')
    writeFileSync(seed, 'action/review HAS action: `?service => ?service IS reviewed`')
    assert.equal(actCommand(['--db', db, '--declare', seed]).code, 0)
    const duplicate = actCommand(['--db', db, 'review', 'service=first', 'service=second'])
    assert.equal(duplicate.code, 1)
    assert.match(duplicate.err, /duplicate parameter.*service/)
    const extra = actCommand(['--db', db, 'review', 'service=api', '__proto__=ignored'])
    assert.equal(extra.code, 1)
    assert.match(extra.err, /unknown parameter.*__proto__/)
    assert.match(queryCommand(['--db', db, '?service IS reviewed']).out, /no matches/)
    assert.equal(actCommand(['--db', db, 'review', 'service=api']).code, 0)
    assert.match(queryCommand(['--db', db, 'api IS reviewed']).out, /api IS reviewed/)
  })
})

test('doctor diagnoses unemittable historical tags without exposing or changing them', () => {
  for (const [key, value] of [['note', 'private\nvalue'], ['private\nkey', null]] as const) withDir(dir => {
    const db = join(dir, 'private-tags.db')
    const store = open(db)
    let id: string
    try {
      id = store.ingest('private-subject IS retained').ids[0]!
      store.db.prepare('INSERT INTO cave_tag (claim_id, key, value) VALUES (?, ?, ?)').run(id, key, value)
    } finally { store.close() }
    const before = readFileSync(db)
    for (const format of [[], ['--json']]) {
      const result = doctorCommand(['--db', db, ...format])
      assert.equal(result.code, 1, result.out)
      assert.doesNotMatch(result.out + result.err, /private/)
      assert.ok(!(result.out + result.err).includes(id))
      if (format.length) assert.ok(JSON.parse(result.out).checks.some((entry: { id: string, status: string }) =>
        entry.id === 'store.rows' && entry.status === 'fail'))
      assert.deepEqual(readFileSync(db), before)
    }
    const repair = new DatabaseSync(db)
    try { repair.prepare('DELETE FROM cave_tag WHERE claim_id = ?').run(id) }
    finally { repair.close() }
    const recovered = doctorCommand(['--db', db, '--json'])
    assert.equal(recovered.code, 0, recovered.out)
  })
})

test('doctor diagnoses unsupported edge roles and permits repair without disclosing data', () => {
  withDir(dir => {
    const db = join(dir, 'private-edges.db')
    const store = open(db)
    try {
      store.ingest('private-subject IS retained\n  BECAUSE private-evidence')
      store.db.prepare('UPDATE cave_edge SET role = ?').run('private-role')
    } finally { store.close() }
    const before = readFileSync(db)
    for (const format of [[], ['--json']]) {
      const result = doctorCommand(['--db', db, ...format])
      assert.equal(result.code, 1, result.out)
      assert.doesNotMatch(result.out + result.err, /private/)
      if (format.length) assert.ok(JSON.parse(result.out).checks.some((entry: { id: string, status: string }) =>
        entry.id === 'store.rows' && entry.status === 'fail'))
      assert.deepEqual(readFileSync(db), before)
    }
    for (const role of ['WHEN', 'VIA', 'BECAUSE', 'QUALIFIES']) {
      const repair = new DatabaseSync(db)
      try { repair.prepare('UPDATE cave_edge SET role = ?').run(role) }
      finally { repair.close() }
      const recovered = doctorCommand(['--db', db, '--json'])
      assert.equal(recovered.code, 0, recovered.out)
    }
  })
})
