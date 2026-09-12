import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { standardRegistry } from '@cavelang/canonical'
import { Loop, Suite, run } from '@cavelang/eval'

/**
 * The knowledge is one connected component around the symptom plus two
 * unreachable claims, so a budgeted reconstruction from the symptom
 * collects exactly the golden.
 */
const knowledgeText = [
  'auth/middleware HAS bug: token-expiry',
  'token-expiry CAUSE reject-valid-tokens',
  '`<=` FIX token-expiry',
  'topic/auth-hardening CONTAINS token-expiry',
  'topic/auth-hardening CONTAINS auth/middleware',
  'unrelated/service USES postgres',
  'deploy VIA github-actions'
].join('\n')

const goldenText = [
  'auth/middleware HAS bug: token-expiry',
  'token-expiry CAUSE reject-valid-tokens',
  '`<=` FIX token-expiry',
  'topic/auth-hardening CONTAINS token-expiry',
  'topic/auth-hardening CONTAINS auth/middleware'
].join('\n')

const loopText = [
  'loop SEEDS reject-valid-tokens',
  'loop HAS query: `why are valid tokens rejected?`'
].join('\n')

const queriesText = [
  'topic/auth-hardening CONTAINS ?m',
  '  ?m = token-expiry',
  '  ?m = auth/middleware'
].join('\n')

const withLoopSuite = (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-eval-loop-'))
  writeFileSync(join(dir, 'incident.cave'), knowledgeText)
  writeFileSync(join(dir, 'incident.golden.cave'), goldenText)
  writeFileSync(join(dir, 'incident.loop.cave'), loopText)
  writeFileSync(join(dir, 'incident.queries.cave'), queriesText)
  return body(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('discovery: a .loop.cave sibling marks the case without becoming its source', () =>
  withLoopSuite(async dir => {
    const suite = Suite.discover([dir])
    assert.deepEqual(suite.problems, [])
    const [kase] = suite.cases
    assert.equal(kase!.source, join(dir, 'incident.cave'))
    assert.equal(kase!.loop, join(dir, 'incident.loop.cave'))
    assert.equal(kase!.queries, join(dir, 'incident.queries.cave'))
  }))

test('parseSpec reads seeds in order, query and budgets; last belief wins', () => {
  const { spec, problems } = Loop.parseSpec([
    'loop SEEDS b',
    'loop SEEDS a',
    'loop SEEDS b',
    'loop HAS query: `first?`',
    'loop HAS query: `second?`',
    'loop HAS steps: 3',
    'loop HAS claims: 9'
  ].join('\n'), standardRegistry)
  assert.deepEqual(problems, [])
  assert.deepEqual(spec.seeds, ['b', 'a'])
  assert.equal(spec.query, 'second?')
  assert.equal(spec.maxSteps, 3)
  assert.equal(spec.maxClaims, 9)
})

test('parseSpec screams on misspelled knobs instead of defaulting', () => {
  const { problems } = Loop.parseSpec([
    'lop SEEDS a',
    'loop HAS step: 5',
    'loop HAS steps: fast',
    'loop CONTAINS a'
  ].join('\n'), standardRegistry)
  assert.equal(problems.length, 5, problems.join('\n'))
  assert.match(problems[0]!, /expected subject 'loop'/)
  assert.match(problems[1]!, /unknown attribute 'step'/)
  assert.match(problems[2]!, /steps must be a positive safe integer/)
  assert.match(problems[3]!, /expected 'loop SEEDS <entity>'/)
  assert.match(problems[4]!, /declares no seeds/)
})

test('loop fixtures self-check: unknown seeds and unreachable goldens are problems', () =>
  withLoopSuite(async dir => {
    writeFileSync(join(dir, 'incident.loop.cave'), 'loop SEEDS ghost')
    const badSeed = await run({ suites: [dir] })
    assert.match(badSeed.cases[0]!.fixture.join('\n'), /seed 'ghost' does not appear in the knowledge/)

    writeFileSync(join(dir, 'incident.loop.cave'), loopText)
    writeFileSync(join(dir, 'incident.golden.cave'), `${goldenText}\nphantom IS real`)
    const unreachable = await run({ suites: [dir] })
    assert.match(unreachable.cases[0]!.fixture.join('\n'), /golden claim not in the knowledge: phantom IS real/)
  }))

test('without an agent the heuristic baseline reconstructs and answers the queries', () =>
  withLoopSuite(async dir => {
    const report = await run({ suites: [dir] })
    assert.deepEqual(report.fixture, [])
    const [kase] = report.cases
    assert.equal(kase!.kind, 'loop')
    assert.equal(kase!.golden, 5)
    const [only] = kase!.runs
    assert.equal(only!.ok, true, only!.note)
    assert.match(only!.note!, /expanded \d+ cue\(s\): reject-valid-tokens → /)
    assert.equal(only!.f1, 1, `misses: ${only!.misses.join(' | ')} extras: ${only!.extras.join(' | ')}`)
    assert.equal(only!.queriesPassed, 1)
    assert.equal(report.mean!.f1, 1)
  }))

test('a function agent drives the LLM policy; queries are asked of the reconstruction', () =>
  withLoopSuite(async dir => {
    const replies = ['reject-valid-tokens', 'token-expiry', 'topic/auth-hardening', 'auth/middleware', 'STOP']
    const prompts: string[] = []
    const report = await run({
      suites: [dir],
      agent: async prompt => {
        prompts.push(prompt)
        return replies[prompts.length - 1] ?? 'STOP'
      }
    })
    const [only] = report.cases[0]!.runs
    assert.equal(only!.ok, true, only!.note)
    assert.equal(only!.f1, 1, `misses: ${only!.misses.join(' | ')} extras: ${only!.extras.join(' | ')}`)
    assert.equal(only!.queriesPassed, 1)
    assert.equal(prompts.length, 5, 'one completion per step, plus the STOP')
    assert.match(prompts[0]!, /Query: why are valid tokens rejected\?/, 'the fixture query reaches the model')

    const lazy = await run({ suites: [dir], agent: async () => 'STOP' })
    const [stopped] = lazy.cases[0]!.runs
    assert.equal(stopped!.ok, true)
    assert.equal(stopped!.produced, 0)
    assert.equal(stopped!.recall, 0)
    assert.equal(stopped!.queriesPassed, 0, 'the knowledge alone answers nothing — only the reconstruction counts')
  }))

test('cancellation stops reconstruction completions and later evaluation runs', () =>
  withLoopSuite(async dir => {
    const controller = new AbortController()
    const reason = new Error('stop reconstruction')
    let calls = 0
    await assert.rejects(run({
      suites: [dir], runs: 3, signal: controller.signal,
      agent: async () => {
        calls++
        controller.abort(reason)
        return 'reject-valid-tokens'
      }
    }), error => error === reason)
    assert.equal(calls, 1)
  }))

test('a failing loop agent is a failed run, not a silent baseline', () =>
  withLoopSuite(async dir => {
    const report = await run({
      suites: [dir],
      agent: async () => {
        throw new Error('rate limited')
      }
    })
    const [only] = report.cases[0]!.runs
    assert.equal(only!.ok, false)
    assert.match(only!.note!, /rate limited/)
    assert.equal(report.failedRuns, 1)
  }))


test('unsafe reconstruction budgets are fixture problems before policy execution', () =>
  withLoopSuite(async dir => {
    for (const attribute of ['steps', 'claims']) {
      writeFileSync(join(dir, 'incident.loop.cave'), `${loopText}\nloop HAS ${attribute}: 9007199254740992`)
      let calls = 0
      const report = await run({ suites: [dir], agent: async () => { calls++; return '[]' } })
      assert.equal(calls, 0)
      assert.equal(report.cases[0]!.runs.length, 0)
      assert.match(report.cases[0]!.fixture.join('\n'), new RegExp(`${attribute} must be a positive safe integer`))
      assert.equal(report.mean, undefined)
      const parsed = Loop.parseSpec(`loop SEEDS a\nloop HAS ${attribute}: 9007199254740991`, standardRegistry)
      assert.deepEqual(parsed.problems, [])
      assert.equal(attribute === 'steps' ? parsed.spec.maxSteps : parsed.spec.maxClaims, Number.MAX_SAFE_INTEGER)
    }
  }))


test('direct reconstruction calls honor cancellation before and after completions', async () => {
  const spec = { seeds: ['reject-valid-tokens'] }
  const reason = new Error('cancel direct reconstruction')
  for (const agent of [undefined, async () => { throw new Error('must not run') }]) {
    await assert.rejects(async () => Loop.runSpec(knowledgeText, spec, standardRegistry, {
      ...(agent === undefined ? {} : { agent }), signal: AbortSignal.abort(reason)
    }), error => error === reason)
  }
  for (const fails of [false, true]) {
    const controller = new AbortController()
    const failure = new Error('completion failed')
    let calls = 0
    await assert.rejects(Loop.runSpec(knowledgeText, spec, standardRegistry, {
      signal: controller.signal,
      agent: async () => {
        calls++
        controller.abort(reason)
        if (fails) throw failure
        return 'reject-valid-tokens'
      }
    }), error => {
      if (!fails) return error === reason
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [reason, failure])
      return true
    })
    assert.equal(calls, 1)
  }
})
