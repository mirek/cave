import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { actCommand, addCommand, backupCommand, cave, checkCommand, commandHelp, demoCommand, deriveCommand, doctorCommand, exportCommand, generateCommand, highlightCommand, importCommand, parseCommand, queryCommand, reconstructCommand, reportCommand, resolveCommand, restoreCommand, suggestAliasCommand, syncCommand } from '@cavelang/cli'
import { open, Schema } from '@cavelang/store'

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
    assert.equal(queryCommand(['a NEEDS c', '--db', db]).out, 'a NEEDS c @ 72%\n')

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
    writeFileSync(bad, '?x NEEDS ?y => ?x NEEDS ?unbound\n')
    const rejected = deriveCommand([bad, '--db', db])
    assert.equal(rejected.code, 0, 'declaration problems are reported, valid rules still fire')
    assert.match(rejected.err, /\?unbound is not bound/)

    assert.equal(deriveCommand(['--db', db, '--min-conf', 'high']).code, 1)
    assert.equal(deriveCommand(['--db', db, '--retract', 'nonexistent']).code, 1)
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
  const unknown = cave(['help', 'frobnicate'])
  assert.equal(unknown.code, 2)
  assert.match(unknown.err, /unknown command/)
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
    assert.equal(result.code, 0, result.err)
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

test('doctor reports a damaged current schema without exposing SQLite details', () => {
  withDir(dir => {
    const secret = 'private-corrupt-store'
    const db = join(dir, `${secret}.db`)
    const store = open(db)
    store.db.exec('DROP TABLE cave_context')
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

test('backup and restore validate required arguments and digests', () => {
  assert.equal(backupCommand([]).code, 1)
  assert.equal(backupCommand(['--verify', 'missing.db', '--db', 'x.db']).code, 1)
  assert.match(backupCommand(['--verify', 'missing.db', '--sha256', 'bad']).err, /64 hexadecimal/)
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
    assert.match(badLimit.err, /--limit expects a positive integer/)
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

test('sync --dry-run reports without writing; --json is machine-readable', () => {
  withDir(dir => {
    const a = join(dir, 'a.db')
    const b = join(dir, 'b.db')
    writeFileSync(join(dir, 'b.cave'), 'x NEEDS y\n')
    assert.equal(addCommand(['--db', b, join(dir, 'b.cave')]).code, 0)

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
