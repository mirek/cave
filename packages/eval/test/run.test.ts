import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureCount, run } from '@cavelang/eval'

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
    writeFileSync(join(dir, 'broken.queries.cave'), 'ghost IS ?x\n  ?x = real')
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
    assert.match(report.cases[0]!.fixture[0]!, /golden does not satisfy 'ghost IS \?x'/)
    assert.match(report.cases[1]!.fixture[0]!, /golden has no claims/)
    assert.deepEqual(report.fixture, [], 'per-case problems stay on their case')
    assert.equal(fixtureCount(report), 2)
    assert.equal(report.mean, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

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
