import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fixtureCount, render, run } from '@cavelang/eval'

const goldenText = [
  'PARENT-OF IS verb',
  'PARENT-OF REVERSE CHILD-OF',
  'maria PARENT-OF anna',
  'anna PARENT-OF me',
  'jan HAS birth-year: 1932 @src:maria @ 70%'
].join('\n')

const queriesText = [
  '?a PARENT-OF+ me',
  '  ?a = anna',
  '  ?a = maria',
  'jan HAS birth-year: ?y',
  '  ?y = 1932'
].join('\n')

/** Writes the standard fixture and hands the suite dir to `body`. */
const withSuite = (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-eval-run-'))
  writeFileSync(join(dir, 'family.md'), 'Maria is the mother of Anna; Anna is my mum. Jan was born in 1932, says Maria.')
  writeFileSync(join(dir, 'family.golden.cave'), goldenText)
  writeFileSync(join(dir, 'family.queries.cave'), queriesText)
  return body(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('evaluation text retains large completed-run diagnostic lists', () =>
  withSuite(async dir => {
    const size = 130_000
    const result = await run({ suites: [dir], mode: 'stdout', agent: async () =>
      goldenText + '\n' + Array.from({ length: size }, () => 'broken').join('\n') })
    assert.equal(fixtureCount(result), 0)
    assert.equal(result.okRuns, 1)
    const runResult = result.cases[0]!.runs[0]!
    assert.equal(runResult.problems.length, size)
    const text = render(result)
    assert.deepEqual(text.split('\n').filter(line => line.startsWith('    problem: ')),
      runResult.problems.map(problem => `    problem: ${problem}`))
  }))

test('large invalid golden fixtures retain diagnostics and skip agent execution', () =>
  withSuite(async dir => {
    const size = 130_000
    writeFileSync(join(dir, 'family.golden.cave'), Array.from({ length: size }, () => 'broken').join('\n'))
    let calls = 0
    const options = { suites: [dir], mode: 'stdout' as const, agent: async () => { calls++; return goldenText } }
    const result = await run(options)
    assert.equal(calls, 0)
    assert.equal(result.cases.length, 1)
    assert.equal(result.cases[0]!.runs.length, 0)
    assert.equal(fixtureCount(result), size + 1)
    const problems = result.cases[0]!.fixture
    for (let i = 0; i < size; i++) assert.ok(problems[i]!.includes(`line ${i + 1}:`))
    assert.equal(problems.at(-1), 'golden has no claims')
    const text = render(result)
    const renderedProblems = text.split('\n').filter(line => line.startsWith('  '))
    assert.deepEqual(renderedProblems, problems.map(problem => `  ${problem}`))
    writeFileSync(join(dir, 'family.golden.cave'), goldenText)
    assert.equal(fixtureCount(await run(options)), 0)
    assert.equal(calls, 1)
  }))

test('repeated evaluation runs retain the originally selected agent', () =>
  withSuite(async dir => {
    let originalCalls = 0
    let replacementCalls = 0
    const options = {
      suites: [dir], mode: 'stdout' as const, runs: 2,
      agent: async () => {
        originalCalls++
        await Promise.resolve()
        options.agent = async () => { replacementCalls++; return 'unrelated IS fact' }
        return goldenText
      }
    }
    const report = await run(options)
    assert.equal(report.okRuns, 2)
    assert.equal(originalCalls, 2)
    assert.equal(replacementCalls, 0)
    assert.equal(report.mean?.f1, 1)
  }))

test('malformed fixture bytes reject evaluation before agent work', () =>
  withSuite(async dir => {
    let calls = 0
    const agent = async () => { calls++; return goldenText }
    for (const [name, content] of [
      ['family.golden.cave', goldenText],
      ['family.queries.cave', queriesText]
    ] as const) {
      const path = join(dir, name)
      writeFileSync(path, Buffer.concat([Buffer.from(content + '\n; '), Buffer.from([0xff])]))
      await assert.rejects(run({ suites: [dir], mode: 'stdout', agent }), error => {
        assert.ok(error instanceof TypeError)
        assert.ok(error.message.includes(path))
        assert.match(error.message, /invalid UTF-8 evaluation fixture/)
        return true
      })
      assert.equal(calls, 0)
      writeFileSync(path, content + '\n; �café 😀')
    }
    const report = await run({ suites: [dir], mode: 'stdout', agent })
    assert.equal(report.okRuns, 1)
    assert.equal(report.mean?.f1, 1)
    assert.equal(calls, 1)
  }))

test('a changed path source remains a failed evaluation even after direct agent writes', () =>
  withSuite(async dir => {
    const report = await run({
      suites: [dir], mode: 'mcp', embed: false,
      agent: async (_prompt, _files, context) => {
        context.store.ingest(goldenText)
        writeFileSync(join(dir, 'family.md'), 'replacement source')
        return 'done'
      }
    })
    assert.equal(report.okRuns, 0)
    assert.equal(report.failedRuns, 1)
    assert.match(report.cases[0]!.runs[0]!.note ?? '', /source changed/)
  }))

test('evaluation cancellation propagates instead of becoming scores or later runs', () =>
  withSuite(async dir => {
    for (const phase of ['agent', 'judge'] as const) {
      const controller = new AbortController()
      const reason = new Error(`stop ${phase}`)
      let agents = 0
      let judges = 0
      let db = ''
      await assert.rejects(run({
        suites: [dir], mode: 'stdout', runs: 3, signal: controller.signal,
        agent: async (_prompt, _files, context) => {
          agents++
          db = context.db
          if (phase === 'agent') controller.abort(reason)
          return 'other IS value'
        },
        judge: async () => {
          judges++
          controller.abort(reason)
          return '[]'
        }
      }), error => error === reason)
      assert.equal(agents, 1)
      assert.equal(judges, phase === 'agent' ? 0 : 1)
      assert.equal(existsSync(db), false, 'cancelled throwaway database is removed')
    }
  }))

test('evaluation rejects invalid modes before discovering suites', async () => {
  for (const mode of ['', 'stdotu', null, true]) {
    await assert.rejects(run({ suites: ['missing-suite'], mode: mode as never }), /mode must be mcp or stdout/)
  }
})

test('evaluation rejects invalid timeouts before discovering suites', async () => {
  for (const timeoutSeconds of [0, -1, NaN, Infinity, 0.0001, 1.0001, 2147483.648]) {
    await assert.rejects(run({ suites: ['missing-suite'], timeoutSeconds }), /timeoutSeconds must resolve to whole milliseconds/)
  }
  for (const timeoutSeconds of [0.001, 1.001, 2147483.647]) {
    assert.deepEqual((await run({ suites: [], timeoutSeconds })).cases, [])
  }
})

test('evaluation rejects invalid run counts before suite or agent work', async () => {
  for (const runs of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(run({
      suites: ['missing-suite'], runs,
      agent: async () => { assert.fail('must not call agent') }
    }), /runs must be a positive safe integer/)
  }
  const empty = await run({ suites: [], runs: Number.MAX_SAFE_INTEGER })
  assert.equal(empty.runs, Number.MAX_SAFE_INTEGER)
  assert.deepEqual(empty.cases, [])
})

test('invalid scoring tolerance fails before agent work', () =>
  withSuite(async dir => {
    for (const tolerance of [NaN, Infinity, -1, 1.1]) {
      let called = false
      await assert.rejects(run({
        suites: [dir], tolerance,
        agent: async () => { called = true; return goldenText }
      }), /tolerance must be a finite number in \[0, 1\]/)
      assert.equal(called, false)
    }
  }))

test('pre-cancelled evaluation rejects before discovering suites', async () => {
  const reason = new Error('already stopped')
  await assert.rejects(run({ suites: ['missing-suite'], signal: AbortSignal.abort(reason) }), error => error === reason)
})

test('a perfect stdout extraction scores F1 1 and passes every query', () =>
  withSuite(async dir => {
    const report = await run({
      suites: [dir],
      mode: 'stdout',
      agent: async () => `\`\`\`cave\n${goldenText}\n\`\`\``
    })
    assert.deepEqual(report.fixture, [])
    assert.equal(report.okRuns, 1)
    assert.equal(report.failedRuns, 0)
    const [kase] = report.cases
    assert.equal(kase!.golden, 5)
    assert.equal(kase!.queryCount, 2)
    const [only] = kase!.runs
    assert.equal(only!.ok, true)
    assert.equal(only!.matched, 5)
    assert.equal(only!.f1, 1)
    assert.deepEqual(only!.misses, [])
    assert.deepEqual(only!.extras, [])
    assert.equal(only!.queriesPassed, 2)
    assert.equal(report.mean!.f1, 1)
    assert.equal(report.mean!.queryRate, 1)
  }))

test('an imperfect extraction reports misses, extras, value-off and failed queries', () =>
  withSuite(async dir => {
    const report = await run({
      suites: [dir],
      mode: 'stdout',
      agent: async () => [
        'PARENT-OF IS verb',
        'PARENT-OF REVERSE CHILD-OF',
        'maria PARENT-OF anna',
        'anna PARENT-OF me',
        'jan HAS birth-year: 1931 @src:maria @ 70%', // right fact, wrong value
        'piotr IS cousin'                            // invented
      ].join('\n')
    })
    const [only] = report.cases[0]!.runs
    assert.equal(only!.ok, true)
    assert.equal(only!.produced, 6)
    assert.equal(only!.matched, 4)
    assert.equal(only!.valueOff, 1)
    assert.deepEqual(only!.misses, ['jan HAS birth-year: 1932 @src:maria @ 70%'])
    assert.deepEqual([...only!.extras].sort(), ['jan HAS birth-year: 1931 @src:maria @ 70%', 'piotr IS cousin'])
    assert.equal(only!.queriesPassed, 1, 'the ancestor chain still answers; the birth year does not')
    const failed = only!.queries.find(outcome => !outcome.pass)
    assert.match(failed!.pattern, /birth-year/)
    assert.deepEqual(failed!.missing, [{ y: '1932' }])
    assert.deepEqual(failed!.unexpected, [{ y: '1931' }])
  }))

test('N runs are independent fresh stores; failed runs are excluded from means', () =>
  withSuite(async dir => {
    let calls = 0
    const report = await run({
      suites: [dir],
      mode: 'stdout',
      runs: 3,
      agent: async () => {
        calls += 1
        if (calls === 2) {
          throw new Error('rate limited')
        }
        return goldenText
      }
    })
    assert.equal(calls, 3)
    assert.equal(report.okRuns, 2)
    assert.equal(report.failedRuns, 1)
    const runs = report.cases[0]!.runs
    assert.equal(runs.length, 3)
    assert.equal(runs[1]!.ok, false)
    assert.match(runs[1]!.note!, /rate limited/)
    assert.equal(runs[0]!.f1, 1, 'run 1 unaffected by run 2 failing')
    assert.equal(runs[2]!.f1, 1, 'run 3 starts from a fresh store, not run 1 leftovers')
    assert.equal(report.mean!.f1, 1, 'means cover ok runs only')
    assert.equal(report.cases[0]!.mean!.queryRate, 1)
  }))

test('mcp mode hands function agents the throwaway store', () =>
  withSuite(async dir => {
    const report = await run({
      suites: [dir],
      mode: 'mcp',
      agent: async (_prompt, files, context) => {
        assert.deepEqual(files, ['family.md'])
        assert.ok(context.db.endsWith('.db'))
        context.store.ingest(goldenText)
        return 'done: 5'
      }
    })
    const [only] = report.cases[0]!.runs
    assert.equal(only!.ok, true)
    assert.equal(only!.note, 'done: 5')
    assert.equal(only!.f1, 1)
  }))

test('shell agents run in the case directory with the ingest contract', () =>
  withSuite(async dir => {
    // The agent reads the golden from the case directory — a perfect,
    // fully deterministic "extraction" through the real subprocess path.
    const report = await run({
      suites: [dir],
      mode: 'stdout',
      agent: 'grep -q "family.md" - && cat family.golden.cave'
    })
    assert.equal(report.failedRuns, 0, JSON.stringify(report.cases[0]!.runs))
    assert.equal(report.mean!.f1, 1)
  }))

test('the judge upgrades naming drift into judged scores without touching strict ones', () =>
  withSuite(async dir => {
    const drifted = goldenText.replace(/maria/g, 'grandma-maria')
    const judgePrompts: string[] = []
    const report = await run({
      suites: [dir],
      mode: 'stdout',
      agent: async () => drifted,
      judge: async prompt => {
        judgePrompts.push(prompt)
        // Pair the two maria/grandma-maria claims; judge conservatively
        // pairs nothing else.
        const misses = prompt.split('\n').filter(line => /^G\d+:/.test(line))
        const extras = prompt.split('\n').filter(line => /^P\d+:/.test(line))
        const pairs: number[][] = []
        for (const [at, miss] of misses.entries()) {
          const counterpart = extras.findIndex(extra =>
            extra.replace(/grandma-maria/g, 'maria').split(': ')[1] === miss.split(': ')[1])
          if (counterpart !== -1) {
            pairs.push([at + 1, counterpart + 1])
          }
        }
        return JSON.stringify(pairs)
      }
    })
    const [only] = report.cases[0]!.runs
    assert.equal(only!.ok, true)
    assert.equal(judgePrompts.length, 1)
    assert.equal(only!.matched, 3, 'strict matching is untouched')
    assert.equal(only!.judged, 2)
    assert.deepEqual(only!.misses, [], 'judged pairs leave the miss list')
    assert.deepEqual(only!.extras, [])
    assert.ok(only!.f1 < 1)
    assert.equal(only!.judgedF1, 1)
    assert.equal(report.mean!.judgedF1, 1)
    assert.ok(report.mean!.f1 < 1)
  }))

test('a shell judge follows the same protocol; judge failure is reported, not fatal', () =>
  withSuite(async dir => {
    const drifted = goldenText.replace(/maria/g, 'grandma-maria')
    const paired = await run({
      suites: [dir],
      mode: 'stdout',
      agent: async () => drifted,
      judge: 'grep -q "G1:" - && printf "[[1, 1], [2, 2]]"'
    })
    assert.equal(paired.cases[0]!.runs[0]!.judged, 2)

    const failing = await run({
      suites: [dir],
      mode: 'stdout',
      agent: async () => drifted,
      judge: 'exit 3'
    })
    const [only] = failing.cases[0]!.runs
    assert.equal(only!.ok, true, 'a broken judge does not fail the run')
    assert.equal(only!.judged, 0)
    assert.match(only!.judgeError!, /exited with 3/)
  }))

test('fixtures that fail self-check are skipped before any agent run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-eval-fixture-'))
  try {
    writeFileSync(join(dir, 'broken.md'), 'source')
    writeFileSync(join(dir, 'broken.golden.cave'), 'a IS b')
    // The golden cannot answer this query — the expectation measures the
    // fixture, not the agent.
    writeFileSync(join(dir, 'broken.queries.cave'), 'ghost IS ?x\n  ?x = real\nghost IS ?x\na IS ?x\n  none')
    writeFileSync(join(dir, 'empty.md'), 'source')
    writeFileSync(join(dir, 'empty.golden.cave'), '; nothing here')
    let calls = 0
    const report = await run({
      suites: [dir],
      mode: 'stdout',
      agent: async () => {
        calls += 1
        return 'a IS b'
      }
    })
    assert.equal(calls, 0, 'no agent money is spent on broken fixtures')
    assert.equal(report.cases.length, 2)
    assert.deepEqual(report.cases[0]!.fixture, [
      "queries line 1: the golden does not satisfy 'ghost IS ?x' (missing ?x = real)",
      "queries line 3: the golden does not satisfy 'ghost IS ?x' (no matches)",
      "queries line 4: the golden does not satisfy 'a IS ?x' (unexpected ?x = b)"
    ])
    assert.match(report.cases[1]!.fixture[0]!, /golden has no claims/)
    assert.deepEqual(report.fixture, [], 'per-case problems stay on their case')
    assert.equal(fixtureCount(report), 4)
    assert.equal(report.mean, undefined)
    writeFileSync(join(dir, 'broken.queries.cave'), 'a IS ?x\n  ?x = b')
    writeFileSync(join(dir, 'empty.golden.cave'), 'a IS b')
    const corrected = await run({ suites: [dir], mode: 'stdout', agent: async () => {
      calls++
      return 'a IS b'
    } })
    assert.equal(calls, 2)
    assert.equal(fixtureCount(corrected), 0)
    assert.equal(corrected.okRuns, 2)
    assert.equal(corrected.mean?.f1, 1)
    assert.equal(corrected.mean?.queryRate, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('evaluation retention remains consistent when the caller changes keep during an agent run', () =>
  withSuite(async dir => {
    for (const keep of [true, false]) {
      let database = ''
      const options = {
        suites: [dir], mode: 'stdout' as const, keep,
        agent: async (_prompt: string, _files: unknown, context: { db: string }) => {
          database = context.db
          options.keep = !keep
          return goldenText
        }
      }
      try {
        const report = await run(options)
        assert.equal(report.okRuns, 1)
        assert.equal(existsSync(database), keep)
        assert.equal(report.root, keep ? dirname(database) : undefined)
        assert.equal(report.cases[0]!.runs[0]!.db, keep ? database : undefined)
      } finally {
        if (database) rmSync(dirname(database), { recursive: true, force: true })
      }
    }
  }))

test('keep retains the per-run databases and reports their directory', () =>
  withSuite(async dir => {
    const report = await run({
      suites: [dir],
      mode: 'stdout',
      keep: true,
      agent: async () => goldenText
    })
    try {
      assert.ok(report.root !== undefined)
      assert.ok(existsSync(report.root!))
      assert.deepEqual(readdirSync(report.root!), ['case-1-run-1.db'])
      assert.equal(report.cases[0]!.runs[0]!.db, join(report.root!, 'case-1-run-1.db'))
    } finally {
      rmSync(report.root!, { recursive: true, force: true })
    }
  }))

test('a source name with glob metacharacters is ingested literally, never as a pattern (BUGS.md eval-glob-escape)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-eval-glob-'))
  try {
    // `[draft]` is a glob character class: as a pattern it matches one
    // character of d/r/a/f/t — the decoy below — and never the literal
    // file, so eval used to ingest the wrong source or report no batch.
    writeFileSync(join(dir, 'notes [draft].md'), 'The auth middleware uses JWT tokens.')
    writeFileSync(join(dir, 'notes [draft].golden.cave'), 'auth USES jwt')
    writeFileSync(join(dir, 'notes d.md'), 'Billing talks to stripe.')
    const batches: (readonly string[])[] = []
    const prompts: string[] = []
    const report = await run({
      suites: [dir],
      mode: 'stdout',
      agent: async (prompt, files) => {
        prompts.push(prompt)
        batches.push(files)
        return 'auth USES jwt'
      }
    })
    assert.deepEqual(report.fixture, [])
    assert.deepEqual(report.cases[0]!.fixture, [])
    assert.equal(report.failedRuns, 0, JSON.stringify(report.cases[0]!.runs))
    assert.equal(report.okRuns, 1)
    assert.deepEqual(batches, [['notes [draft].md']], 'the discovered source itself, not what its name glob-matches')
    assert.match(prompts[0]!, /JWT tokens/, 'the prompt embeds the real source, not the decoy')
    assert.equal(report.mean!.f1, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stdout-mode lint problems are reported while valid lines still score', () =>
  withSuite(async dir => {
    const report = await run({
      suites: [dir],
      mode: 'stdout',
      agent: async () => `${goldenText}\nthis line is not cave at all`
    })
    const [only] = report.cases[0]!.runs
    assert.equal(only!.ok, true)
    assert.equal(only!.problems.length, 1)
    assert.equal(only!.f1, 1)
  }))

test('judge arrays embedded in strings or unrelated object fields cannot improve scores', () =>
  withSuite(async dir => {
    for (const reply of ['"[[1,1],[2,2]]"', '{"rejected":[[1,1],[2,2]]}']) {
      const report = await run({ suites: [dir], mode: 'stdout',
        agent: async () => goldenText.replace(/maria/g, 'grandma-maria'), judge: async () => reply })
      const only = report.cases[0]!.runs[0]!
      assert.equal(only.ok, true)
      assert.equal(only.judged, 0)
      assert.equal(only.judgedF1, only.f1)
      assert.equal(only.misses.length, 2)
      assert.equal(only.extras.length, 2)
    }
  }))


test('query binding fixture errors stop agent work and corrected literal bindings score', () =>
  withSuite(async dir => {
    const claim = 'api HAS note: "literal ?note = text; data"'
    writeFileSync(join(dir, 'family.golden.cave'), claim)
    const queryPath = join(dir, 'family.queries.cave')
    writeFileSync(queryPath, '?__proto__ HAS note: ?note\n  ?__proto__ = ghost ?__proto__ = api ?note = "literal ?note = text; data"')
    let calls = 0
    const agent = async () => { calls++; return claim }
    const broken = await run({ suites: [dir], mode: 'stdout', agent })
    assert.equal(calls, 0)
    assert.equal(broken.okRuns, 0)
    assert.equal(broken.cases[0]!.runs.length, 0)
    assert.equal(fixtureCount(broken), 1)
    assert.match(broken.cases[0]!.fixture[0]!, /queries line 2: expected/)
    assert.equal(broken.mean, undefined)

    writeFileSync(queryPath, '?__proto__ HAS note: ?note\n  ?__proto__ = api ?note = "literal ?note = text; data"')
    const corrected = await run({ suites: [dir], mode: 'stdout', agent })
    assert.equal(calls, 1)
    assert.equal(fixtureCount(corrected), 0)
    assert.equal(corrected.okRuns, 1)
    assert.equal(corrected.failedRuns, 0)
    assert.equal(corrected.mean?.f1, 1)
    assert.equal(corrected.mean?.queryRate, 1)
    assert.equal(corrected.cases[0]!.runs[0]!.queriesPassed, 1)
  }))


test('invalid explicit instructions never fall back or invoke an agent', () =>
  withSuite(async dir => {
    writeFileSync(join(dir, 'instructions.md'), 'fallback instructions')
    let calls = 0
    const agent = async () => { calls++; return goldenText }
    for (const instructions of [join(dir, 'missing.md'), dir]) {
      const report = await run({ suites: [dir], mode: 'stdout', instructions, agent })
      assert.equal(calls, 0)
      assert.equal(report.cases.length, 0)
      assert.equal(report.fixture.length, 1)
      assert.ok(report.fixture[0]!.includes(instructions))
      assert.match(report.fixture[0]!, /instructions must name an existing file/)
    }
    const recovered = await run({ suites: [dir], mode: 'stdout', instructions: join(dir, 'instructions.md'), agent })
    assert.equal(calls, 1)
    assert.equal(recovered.okRuns, 1)
    assert.equal(recovered.mean?.f1, 1)
  }))
