import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { Registry } from '@cavelang/canonical'
import { query } from '@cavelang/query'
import { declareRules, derive } from '@cavelang/rules'
import { declareActions } from '@cavelang/act'
import {
  appendReply, Automation, declareAutomations, listAutomations, loadAutomations, retractAutomation, settle, settled, watermarkAttribute
} from '@cavelang/automate'
import type { SettleReport } from '@cavelang/automate'

const claimCount = (store: ReturnType<typeof open>): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n

const firedOf = (report: SettleReport, subject: string): number =>
  report.automations.find(automation => automation.subject === subject)?.fired ?? 0

test('prelude diagnostics retain original lines after declarations', () => {
  for (const newline of ['\n', '\r\n']) {
    const store = open()
    try {
      const lines = ['; heading', 'automation/watch HAS automation: `?x IS service => hook/log`', '', '; middle', 'broken HAS']
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const invalid = declareAutomations(store, lines.join(newline))
      assert.equal(invalid.declared, 0)
      assert.equal(invalid.prelude, 0)
      assert.deepEqual(invalid.problems.map(problem => problem.line), [5])
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      lines[4] = 'thing IS service'
      const corrected = declareAutomations(store, lines.join(newline))
      assert.deepEqual(corrected.problems, [])
      assert.equal(corrected.declared, 1)
      const repeated = declareAutomations(store, lines.join(newline))
      assert.equal(repeated.unchanged, 1)
      assert.equal(repeated.prelude, 0)
    } finally { store.close() }
  }
})

test('alias policy reevaluates derivations without replaying handled automation events', async () => {
  const store = open()
  try {
    store.ingest('postgres ALIAS postgresql')
    declareRules(store, '?x USES postgres => ?x IS database-client')
    declareAutomations(store, 'automation/review HAS automation: `?x USES postgres => "Review ?x"`')
    store.ingest('billing USES postgres\nanalytics USES postgresql')
    const prompts: string[] = []
    const complete = async (prompt: string) => { prompts.push(prompt); return '' }
    assert.equal(firedOf(await settle(store, { complete }), 'automation/review'), 1)
    const before = [...prompts]
    assert.equal(firedOf(await settle(store, { complete, aliases: true }), 'automation/review'), 0)
    assert.deepEqual(prompts, before)
    assert.deepEqual(query(store, '?x IS database-client').map(match => match.bindings['x']).sort(), ['analytics', 'billing'])
    store.ingest('warehouse USES postgresql')
    assert.equal(firedOf(await settle(store, { complete, aliases: true }), 'automation/review'), 1)
    assert.equal(prompts.length, 2)
    assert.match(prompts[1]!, /warehouse/)
    assert.equal(firedOf(await settle(store, { complete }), 'automation/review'), 0)
    assert.equal(prompts.length, 2)
    assert.deepEqual(query(store, '?x IS database-client').map(match => match.bindings['x']), ['billing'])
  } finally { store.close() }
})

test('indexed automation discovery preserves disabled winners across actor series', async t => {
  const store = open()
  try {
    store.ingest(Array.from({ length: 1000 }, (_, i) => `item/${i} IS record`).join('\n'))
    store.ingest('automation/watch HAS automation: `?x IS service => "Review ?x"` @src:first')
    store.ingest('automation/watch HAS automation: `?x IS service => "Review ?x"` @src:second @ 0%')
    t.mock.method(store, 'currentBeliefs', () => { throw new Error('materialized all current beliefs') })
    assert.deepEqual(listAutomations(store), [])
    assert.equal((await settle(store, { derive: false })).automations.length, 0)
    store.ingest('automation/watch HAS automation: `?x IS service => "Review ?x"` @src:second')
    assert.equal(listAutomations(store).length, 1)
    const retired = retractAutomation(store, 'watch')
    assert.ok(retired.ok)
    if (retired.ok) assert.equal(retired.retracted, 2)
    assert.deepEqual(listAutomations(store), [])
  } finally { store.close() }
})

test('invalid automation pass limits leave pending work and watermarks untouched', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/review HAS automation: `?x IS service => "Review ?x"`')
    store.ingest('api IS service')
    let calls = 0
    const complete = async () => { calls += 1; return 'api IS reviewed' }
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const maxPasses of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(settle(store, { maxPasses, complete }), /maxPasses.*positive safe integer/)
      assert.equal(calls, 0)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    const result = await settle(store, { maxPasses: Number.MAX_SAFE_INTEGER, complete })
    assert.equal(settled(result), true)
    assert.equal(calls, 1)
  } finally { store.close() }
})

test('supported prototype-named trigger bindings reach governed action parameters', async () => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty']) {
    const store = open()
    try {
      assert.equal(declareActions(store, `action/review HAS action: \`?${name} => ?${name} IS reviewed\``).declared, 1)
      const declaration = declareAutomations(store,
        `automation/review HAS automation: \`?${name} IS service => action/review\``)
      assert.deepEqual(declaration.problems, [])
      store.ingest('api IS service')
      const report = await settle(store, { derive: false })
      assert.equal(settled(report), true, JSON.stringify(report))
      assert.equal(firedOf(report, 'automation/review'), 1)
      assert.equal(report.automations[0]!.firings[0]!.steps[0]!.outcome, 'ok')
      const effect = query(store, 'api IS reviewed @src:action/review')[0]!.row!
      assert.ok(store.edgesOf(effect.id).some(edge => edge.role === 'VIA'))
      const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.equal(firedOf(await settle(store, { derive: false }), 'automation/review'), 0)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    } finally { store.close() }
  }
})

test('prototype-named trigger bindings reach prompts and fire only once', async () => {
  const store = open()
  try {
    const declaration = declareAutomations(store,
      'automation/review HAS automation: `?__proto__ IS service, ?__proto__ HAS owner: ?constructor => "Review ?__proto__ for ?constructor"`')
    assert.deepEqual(declaration.problems, [])
    assert.equal(declaration.declared, 1)
    store.ingest('api IS service\napi HAS owner: platform')
    const prompts: string[] = []
    const options = { derive: false, complete: async (prompt: string) => {
      prompts.push(prompt)
      return 'api IS reviewed'
    } }
    const result = await settle(store, options)
    assert.equal(firedOf(result, 'automation/review'), 1)
    assert.equal(prompts.length, 1)
    assert.ok(prompts[0]!.includes('Review api for platform'), prompts[0])
    const bindings = result.automations[0]!.firings[0]!.bindings
    assert.ok(Object.hasOwn(bindings, '__proto__'))
    assert.deepEqual(JSON.parse(JSON.stringify(bindings)), { ['__proto__']: 'api', constructor: 'platform' })
    assert.equal(query(store, 'api IS reviewed').length, 1)
    assert.equal(firedOf(await settle(store, options), 'automation/review'), 0)
    assert.equal(prompts.length, 1)
  } finally { store.close() }
})

test('retraction includes actor declarations committed before write reservation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automation-retract-'))
  const store = open(join(dir, 'store.db'))
  const peer = open(join(dir, 'store.db'))
  try {
    const declaration = 'automation/watch HAS automation: `?x IS event => action/handle`'
    store.ingest(declaration, { source: 'first' })
    const racing: typeof store = {
      ...store,
      transaction(work) {
        peer.ingest(declaration, { source: 'second' })
        return store.transaction(work)
      }
    }
    const result = retractAutomation(racing, 'watch')
    assert.deepEqual(result, { ok: true, subject: 'automation/watch', retracted: 2 })
    assert.deepEqual(listAutomations(store), [])
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stored rule parse failures make settling unsuccessful while valid rules still run', async () => {
  const store = open()
  try {
    store.ingest('rule/broken HAS rule: `not a rule`\napi IS hot')
    declareRules(store, '?x IS hot => ?x IS watched')
    const report = await settle(store)
    assert.equal(settled(report), false)
    assert.equal(report.problems.length, 1)
    assert.equal(report.problems[0]!.subject, 'rule/broken')
    assert.ok(report.problems[0]!.problems.length > 0)
    assert.equal(query(store, 'api IS watched').length, 1)
    assert.equal(settled(await settle(store, { derive: false })), true)
    store.ingest('rule/broken HAS rule: `not a rule` @ 0%')
    assert.equal(settled(await settle(store)), true)
  } finally {
    store.close()
  }
})

test('an already-cancelled settle leaves the store untouched', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
    store.ingest('api IS hot')
    const before = claimCount(store)
    const reason = new Error('cancel before settling')
    await assert.rejects(settle(store, { signal: AbortSignal.abort(reason) }), error => error === reason)
    assert.equal(claimCount(store), before)
  } finally {
    store.close()
  }
})

test('settle retains its cancellation signal when caller options change during completion', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/review HAS automation: `?x IS service => "review ?x"`')
    store.ingest('api IS service')
    const controller = new AbortController()
    const reason = new Error('cancel captured run')
    const options = {
      signal: controller.signal as AbortSignal | undefined,
      derive: false,
      complete: async () => {
        await Promise.resolve()
        options.signal = undefined
        controller.abort(reason)
        return 'api IS reviewed'
      }
    }
    await assert.rejects(settle(store, options), error => error === reason)
    assert.equal(query(store, 'api IS reviewed').length, 0)
  } finally { store.close() }
})

test('cancellation discards an agent reply and stops remaining steps without replaying the claimed batch', async () => {
  const store = open()
  try {
    declareActions(store, 'action/flag HAS action: `?x => ?x IS flagged`')
    declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => "review ?x", action/flag`')
    store.ingest('api IS hot')
    const controller = new AbortController()
    const reason = new Error('cancel during completion')
    await assert.rejects(settle(store, {
      signal: controller.signal,
      complete: async () => { controller.abort(reason); return 'api IS reviewed' },
    }), error => error === reason)
    assert.equal(query(store, 'api IS reviewed').length, 0)
    assert.equal(query(store, 'api IS flagged').length, 0)
    assert.equal(query(store, `automation/watch HAS ${watermarkAttribute}: ?tx`).length, 1)
    assert.equal(firedOf(await settle(store), 'automation/watch'), 0)
  } finally {
    store.close()
  }
})

test('pass exhaustion is incomplete and a later quiet cycle confirms completion without replay', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
    store.ingest('api IS hot')
    const exhausted = await settle(store, { maxPasses: 1 })
    assert.equal(settled(exhausted), false)
    assert.equal(exhausted.complete, false)
    assert.equal(firedOf(exhausted, 'automation/watch'), 1)
    assert.match(exhausted.notes.join('\n'), /stopped at 1 passes/)
    const resumed = await settle(store, { maxPasses: 1 })
    assert.equal(resumed.complete, true)
    assert.equal(settled(resumed), true)
    assert.equal(firedOf(resumed, 'automation/watch'), 0)
  } finally {
    store.close()
  }
})

test('rule derivation exhaustion is reported and can be resumed with a higher derivation limit', async () => {
  const store = open()
  try {
    declareRules(store, '?x IS reached, ?x NEXT ?y => ?y IS reached')
    declareAutomations(store, 'automation/review HAS automation: `?x IS service => "review ?x"`')
    store.ingest('api IS service\nnode/0 IS reached\n' + Array.from({ length: 25 }, (_, i) => `node/${i} NEXT node/${i + 1}`).join('\n'))
    const prompts: string[] = []
    const options = { maxPasses: 1, complete: async (prompt: string) => { prompts.push(prompt); return '' } }
    const first = await settle(store, options)
    assert.equal(first.complete, false)
    assert.equal(firedOf(first, 'automation/review'), 1,
      'incomplete derivation does not gate independent automation steps')
    assert.equal(prompts.length, 1)
    assert.match(prompts[0]!, /api IS service/)
    const mark = () => store.currentBeliefs().find(row =>
      row.subject === 'automation/review' && row.attribute === watermarkAttribute)!.id
    const claimed = mark()
    const report = await settle(store, options)
    assert.equal(settled(report), false)
    assert.equal(report.complete, false)
    assert.match(report.notes.join('\n'), /derivation did not reach a fixpoint/)
    assert.equal(firedOf(report, 'automation/review'), 0)
    assert.equal(derive(store, { maxPasses: 40 }).complete, true)
    const recovered = await settle(store, options)
    assert.equal(settled(recovered), true)
    assert.equal(firedOf(recovered, 'automation/review'), 0)
    assert.equal(prompts.length, 1, 'recovery does not replay an already-claimed step')
    assert.equal(mark(), claimed)
  } finally {
    store.close()
  }
})

test('declaring arms the automation — rows before the declaration are state, not events (spec §29.2)', async () => {
  const store = open()
  store.ingest('web IS hot')
  declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')

  const first = await settle(store)
  assert.equal(firedOf(first, 'automation/watch'), 0, 'pre-declaration rows never fire')

  store.ingest('api IS hot')
  const second = await settle(store)
  assert.equal(firedOf(second, 'automation/watch'), 1)
  const firing = second.automations[0]!.firings[0]!
  assert.equal(firing.bindings['x'], 'api')
  assert.equal(firing.steps[0]!.outcome, 'not-configured', 'unconfigured hooks are a legitimate mode (spec §25.4)')
  store.close()
})

test('firing records the watermark first, and re-runs never re-fire (spec §29.3)', async () => {
  const store = open()
  declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
  store.ingest('api IS hot')
  await settle(store)

  const marks = query(store, `automation/watch HAS ${watermarkAttribute}: ?tx`)
  assert.equal(marks.length, 1, 'the watermark series is the firing log')
  assert.match(marks[0]!.row!.comment ?? '', /fired 1 solution\(s\)/)

  const rows = claimCount(store)
  const again = await settle(store)
  assert.equal(firedOf(again, 'automation/watch'), 0)
  const third = await settle(store)
  assert.equal(firedOf(third, 'automation/watch'), 0)
  assert.equal(claimCount(store), rows, 'quiescent cycles append nothing — bookkeeping never accretes')
  store.close()
})

test('two settlers cannot claim the same event batch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-settle-race-'))
  const store = open(join(dir, 'knowledge.db'))
  const peer = open(join(dir, 'knowledge.db'))
  try {
    declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
    store.ingest('api IS hot')
    let competing: Promise<SettleReport> | undefined
    let reservations = 0
    const intercepted = new Proxy(store, {
      get(target, property, receiver) {
        if (property === 'transaction' || property === 'ingest') {
          const method = Reflect.get(target, property, receiver)
          return (...args: unknown[]) => {
            // Skip the initial ownership check; interleave at the batch claim.
            if (property !== 'transaction' || ++reservations > 1) {
              competing ??= settle(peer, { derive: false })
            }
            return Reflect.apply(method, target, args)
          }
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const first = await settle(intercepted, { derive: false })
    assert.ok(competing)
    const second = await competing
    assert.equal(firedOf(first, 'automation/watch') + firedOf(second, 'automation/watch'), 1)
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a declaration revoked while an earlier prompt runs cannot fire', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/first HAS automation: `?x IS hot => "review ?x"`\nautomation/second HAS automation: `?x IS hot => hook/log`')
    store.ingest('api IS hot')
    const report = await settle(store, {
      derive: false,
      complete: async () => {
        assert.ok(retractAutomation(store, 'second').ok)
        return ''
      },
    })
    assert.equal(firedOf(report, 'automation/first'), 1)
    assert.equal(firedOf(report, 'automation/second'), 0)
  } finally {
    store.close()
  }
})

test('settling without derivation refreshes a peer writer\'s inverse vocabulary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-settle-vocabulary-'))
  const store = open(join(dir, 'knowledge.db'))
  const peer = open(join(dir, 'knowledge.db'))
  try {
    declareAutomations(peer, 'automation/watch HAS automation: `?x MANAGED-BY alice => hook/log`')
    peer.ingest('MANAGES IS verb\nMANAGES REVERSE MANAGED-BY\nalice MANAGES api')
    assert.equal(firedOf(await settle(store, { derive: false }), 'automation/watch'), 1)
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('settling rejects caller-owned transactions before claiming or executing a batch', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => "review ?x"`')
    store.ingest('api IS hot')
    const before = claimCount(store)
    let pending!: Promise<SettleReport>
    let calls = 0
    store.transaction(() => {
      pending = settle(store, { complete: async () => { calls += 1; return '' } })
    })
    await assert.rejects(pending, /caller-owned transaction/)
    assert.equal(calls, 0)
    assert.equal(claimCount(store), before)
  } finally {
    store.close()
  }
})

test('agent steps see a committed watermark and leave the store available to other writers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-settle-commit-'))
  const store = open(join(dir, 'knowledge.db'))
  const peer = open(join(dir, 'knowledge.db'))
  try {
    declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => "review ?x"`')
    store.ingest('api IS hot')
    let calls = 0
    const report = await settle(store, {
      derive: false,
      complete: async () => {
        calls += 1
        assert.equal(query(peer, `automation/watch HAS ${watermarkAttribute}: ?tx`).length, 1)
        peer.ingest('review IS started')
        assert.equal(firedOf(await settle(peer, { derive: false }), 'automation/watch'), 0)
        peer.ingest('cache IS hot')
        const next = await settle(peer, { derive: false })
        assert.equal(firedOf(next, 'automation/watch'), 1)
        assert.equal(next.automations[0]!.firings[0]!.bindings['x'], 'cache')
        return ''
      },
    })
    assert.equal(calls, 1)
    assert.equal(firedOf(report, 'automation/watch'), 1)
    assert.equal(query(store, 'review IS started').length, 1)
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a re-declared automation does not arm at its stale watermark (BUGS.md automate-stale-watermark, spec §29.2)', async () => {
  const store = open()
  const text = 'automation/watch HAS automation: `?x IS hot => hook/log`'
  declareAutomations(store, text)
  store.ingest('api IS hot')
  assert.equal(firedOf(await settle(store), 'automation/watch'), 1, 'the first firing records a watermark')

  // Retract the automation, record a row while it is retracted, then
  // declare the identical text again. The watermark claim stays current
  // through the retraction, but rows recorded before the re-declaration
  // are state, never events (§29.2).
  assert.ok(retractAutomation(store, 'watch').ok)
  store.ingest('db IS hot')
  assert.equal(declareAutomations(store, text).declared, 1)
  assert.equal(firedOf(await settle(store), 'automation/watch'), 0, 'rows recorded while retracted never fire')

  store.ingest('cache IS hot')
  const after = await settle(store)
  assert.equal(firedOf(after, 'automation/watch'), 1, 'a row after the re-declaration is an event')
  const fired = after.automations.find(automation => automation.subject === 'automation/watch')!
  assert.equal(fired.firings.length, 1)
  assert.equal(fired.firings[0]!.bindings['x'], 'cache', 'the pre-declaration row stays state')
  store.close()
})

test('constraints gate the trigger; an updated value is a new event', async () => {
  const store = open()
  declareAutomations(store, 'automation/spike HAS automation: `?s HAS error-rate: ?r, ?r > 0.05 => hook/page`')
  store.ingest('api HAS error-rate: 0.01')
  assert.equal(firedOf(await settle(store), 'automation/spike'), 0, 'below the threshold')

  store.ingest('api HAS error-rate: 0.09')
  assert.equal(firedOf(await settle(store), 'automation/spike'), 1, 'crossing fires')

  store.ingest('api HAS error-rate: 0.12')
  assert.equal(firedOf(await settle(store), 'automation/spike'), 1, 'each new reading above threshold is an event')
  store.close()
})

test('a retraction fires nothing — the fact stops matching (spec §29.2)', async () => {
  const store = open()
  declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
  store.ingest('api IS hot')
  await settle(store)
  store.ingest('api IS hot @ 0%')
  assert.equal(firedOf(await settle(store), 'automation/watch'), 0)
  store.close()
})

test('a new edge is an event for a transitive trigger (BUGS.md transitive-trigger-rows, spec §29.2)', async () => {
  const store = open()
  store.ingest('dog EXTENDS animal')
  declareAutomations(store, 'automation/lineage HAS automation: `?x EXTENDS+ animal => hook/log`')
  const first = await settle(store)
  assert.equal(firedOf(first, 'automation/lineage'), 0, 'pre-declaration edges are state, not events')

  store.ingest('terrier EXTENDS dog')
  const second = await settle(store)
  assert.equal(firedOf(second, 'automation/lineage'), 1, 'the new edge fires the connection it creates')
  const fired = second.automations.find(automation => automation.subject === 'automation/lineage')!
  assert.equal(fired.firings[0]!.bindings['x'], 'terrier', 'the pre-existing dog→animal connection stays state')

  const again = await settle(store)
  assert.equal(firedOf(again, 'automation/lineage'), 0, 'the edge is behind the watermark now')
  store.close()
})

test('transitive supporting edges ride into prompts as trigger claims (spec §29.3)', async () => {
  const store = open()
  store.ingest('dog EXTENDS animal')
  declareAutomations(store, 'automation/lineage HAS automation: `?x EXTENDS+ animal => "welcome ?x"`')
  await settle(store)

  store.ingest('terrier EXTENDS dog')
  const prompts: string[] = []
  await settle(store, { complete: async prompt => { prompts.push(prompt); return '' } })
  assert.equal(prompts.length, 1)
  assert.match(prompts[0]!, /terrier EXTENDS dog/, 'the event edge rides in the prompt')
  assert.match(prompts[0]!, /dog EXTENDS animal/, 'so does the rest of the supporting path')
  store.close()
})

test('an own action step’s edge never re-fires a transitive trigger — deaf to its echo (spec §29.2)', async () => {
  const store = open()
  store.ingest('dog EXTENDS animal')
  declareActions(store, 'action/graft HAS action: `?x => puppy EXTENDS ?x`')
  declareAutomations(store, 'automation/lineage HAS automation: `?x EXTENDS+ animal => action/graft`')
  store.ingest('terrier EXTENDS dog')

  const report = await settle(store)
  assert.equal(firedOf(report, 'automation/lineage'), 1, 'the hand-written edge fires once')
  assert.equal(query(store, 'puppy EXTENDS terrier @src:action/graft').length, 1, 'the action ran')
  assert.equal(query(store, 'puppy EXTENDS puppy').length, 0, 'the effect edge is not an event for its own automation')
  assert.equal(firedOf(await settle(store), 'automation/lineage'), 0)
  store.close()
})

test('action steps execute with trigger-bound parameters and lineage (spec §29.3)', async () => {
  const store = open()
  declareActions(store, 'action/flag HAS action: `?svc => ?svc IS flagged`')
  declareAutomations(store, 'automation/auto-flag HAS automation: `?svc IS overloaded => action/flag`')
  store.ingest('api IS overloaded')

  const report = await settle(store)
  assert.equal(firedOf(report, 'automation/auto-flag'), 1)
  const step = report.automations[0]!.firings[0]!.steps[0]!
  assert.equal(step.outcome, 'ok')
  assert.equal(step.appended, 1)
  assert.equal(query(store, 'api IS flagged @src:action/flag').length, 1)
  assert.ok(settled(report))

  // Idempotent under the §25.2 convention: the same event never lands twice,
  // and the action's own output is not an event for this automation.
  const again = await settle(store)
  assert.equal(firedOf(again, 'automation/auto-flag'), 0)
  store.close()
})

test('an unbound action parameter fails the step, loudly and locally', async () => {
  for (const name of ['level', 'constructor', 'toString', 'hasOwnProperty']) {
    const store = open()
    try {
      declareActions(store, `action/flag HAS action: \`?svc, ?${name} => ?svc HAS alert-level: ?${name}\`\n` +
        'action/review HAS action: `?svc => ?svc IS reviewed`')
      declareAutomations(store, 'automation/auto-flag HAS automation: `?svc IS overloaded => action/flag, action/review`')
      store.ingest('api IS overloaded')

      const report = await settle(store)
      const steps = report.automations[0]!.firings[0]!.steps
      assert.equal(steps[0]!.outcome, 'failed')
      assert.ok(steps[0]!.detail?.includes(`did not bind ?${name}`), steps[0]!.detail)
      assert.equal(steps[1]!.outcome, 'ok')
      assert.equal(query(store, 'api HAS alert-level: ?value').length, 0)
      assert.equal(query(store, 'api IS reviewed @src:action/review').length, 1)
      assert.equal(settled(report), false)
      const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.equal(firedOf(await settle(store), 'automation/auto-flag'), 0)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    } finally { store.close() }
  }
})

test('hook steps get shell-quoted placeholders and the trigger claims on stdin (spec §29.3)', async () => {
  const store = open()
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-'))
  const file = join(dir, 'hook.txt')
  declareAutomations(store, 'automation/page HAS automation: `?svc IS overloaded => hook/page`')
  store.ingest('api IS overloaded @ 90%')

  const report = await settle(store, { hooks: { page: `{ printf '%s|' {automation} {svc}; cat; } >> ${file}` } })
  assert.equal(report.automations[0]!.firings[0]!.steps[0]!.outcome, 'ok')
  const recorded = readFileSync(file, 'utf8')
  assert.match(recorded, /^page\|api\|/)
  assert.match(recorded, /api IS overloaded @ 90%/)
  rmSync(dir, { recursive: true, force: true })
  store.close()
})

test('prompt steps substitute bindings, append the stamped reply, and stay deaf to their echo (spec §29.3)', async () => {
  const store = open()
  declareAutomations(store,
    'automation/triage HAS automation: `?svc IS overloaded => "look into ?svc"` ; triage overloads')
  store.ingest('api IS overloaded')

  const prompts: string[] = []
  const report = await settle(store, {
    complete: async prompt => {
      prompts.push(prompt)
      return 'api HAS triage-note: "scale up" @src:model-output\n'
    }
  })
  assert.equal(firedOf(report, 'automation/triage'), 1)
  assert.equal(prompts.length, 1)
  assert.match(prompts[0]!, /look into api/, 'bound ?svc substitutes into the instruction')
  assert.match(prompts[0]!, /api IS overloaded/, 'trigger claims ride in the prompt')
  assert.match(prompts[0]!, /triage overloads/, 'the description frames the prompt')
  assert.equal(query(store, 'api HAS triage-note: ?n @src:automation/triage').length, 1)
  const reply = query(store, 'api HAS triage-note: ?n @src:automation/triage')[0]!.row!
  assert.ok(store.toClaim(reply).contexts.includes('src:model-output'))
  assert.ok(store.provenanceOf(reply).runs.includes('automation/triage'))

  // The reply is this automation's own output — no re-fire, and an
  // identical reply appends nothing anywhere.
  const rows = claimCount(store)
  const again = await settle(store, { complete: async () => 'api HAS triage-note: "scale up" @src:model-output\n' })
  assert.equal(firedOf(again, 'automation/triage'), 0)
  assert.equal(claimCount(store), rows)
  store.close()
})

test('prompt substitution preserves bound variable text and replacement metacharacters', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/literal HAS automation: `?x REL ?long => "Values: ?long | ?x | ?unknown | ?longer"`')
    const value = "?x $& $$ $` $'"
    store.ingest(`a REL ${JSON.stringify(value)}`)
    const prompts: string[] = []
    const result = await settle(store, { complete: async prompt => {
      prompts.push(prompt)
      return 'review IS complete'
    } })
    assert.equal(firedOf(result, 'automation/literal'), 1)
    assert.equal(prompts.length, 1)
    assert.ok(prompts[0]!.includes(`Values: ${value} | a | ?unknown | ?longer`), prompts[0])
    assert.equal(query(store, 'review IS complete').length, 1)
  } finally {
    store.close()
  }
})

test('a prompt step without an agent is reported, never fatal (spec §29.3)', async () => {
  const store = open()
  declareAutomations(store, 'automation/triage HAS automation: `?svc IS overloaded => "look into ?svc"`')
  store.ingest('api IS overloaded')
  const report = await settle(store)
  assert.equal(report.automations[0]!.firings[0]!.steps[0]!.outcome, 'not-configured')
  assert.ok(settled(report), 'not-configured is a side-effect-free mode, not a failure')
  store.close()
})

test('unprintable agent errors remain failed steps and preserve later event processing', async () => {
  const unreadable = new Error('unreadable')
  Object.defineProperty(unreadable, 'message', { get() { throw new Error('message unavailable') } })
  for (const failure of [Object.create(null), unreadable]) {
    const store = open()
    try {
      declareAutomations(store, 'automation/triage HAS automation: `?svc IS overloaded => "look into ?svc", hook/log`')
      store.ingest('api IS overloaded')
      const report = await settle(store, {
        complete: async () => { throw failure }, hooks: { log: 'true' }
      })
      const [prompt, hook] = report.automations[0]!.firings[0]!.steps
      assert.equal(prompt!.outcome, 'failed')
      assert.equal(prompt!.detail, '[unprintable thrown value]')
      assert.equal(hook!.outcome, 'ok')
      assert.equal(settled(report), false)
      assert.doesNotThrow(() => JSON.stringify(report))
      let calls = 0
      const complete = async () => { calls++; return '' }
      assert.equal(firedOf(await settle(store, { complete, hooks: { log: 'true' } }), 'automation/triage'), 0)
      store.ingest('worker IS overloaded')
      assert.equal(firedOf(await settle(store, { complete, hooks: { log: 'true' } }), 'automation/triage'), 1)
      assert.equal(calls, 1)
    } finally { store.close() }
  }
})

test('action persistence failures roll back all effects and preserve later steps without replay', async () => {
  const store = open()
  try {
    declareActions(store, 'action/flag HAS action: `?svc => ?svc IS pending, ?svc IS flagged`\n' +
      'action/review HAS action: `?svc => ?svc IS reviewed`')
    declareAutomations(store, 'automation/triage HAS automation: `?svc IS overloaded => action/flag, action/review`')
    store.ingest('api IS overloaded')
    store.db.exec(`CREATE TRIGGER reject_action_effect BEFORE INSERT ON cave_claim
      WHEN NEW.object = 'flagged'
      BEGIN SELECT RAISE(ABORT, 'action persistence interrupted'); END`)
    const report = await settle(store)
    const [flag, review] = report.automations[0]!.firings[0]!.steps
    assert.equal(flag!.outcome, 'failed')
    assert.match(flag!.detail!, /action persistence interrupted/)
    assert.equal(review!.outcome, 'ok')
    assert.equal(settled(report), false)
    assert.equal(query(store, 'api IS reviewed').length, 1)
    const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.doesNotMatch(history, /api IS pending|api IS flagged/)
    store.db.exec('DROP TRIGGER reject_action_effect')
    assert.equal(firedOf(await settle(store), 'automation/triage'), 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    store.ingest('worker IS overloaded')
    const recovered = await settle(store)
    assert.equal(firedOf(recovered, 'automation/triage'), 1)
    assert.equal(settled(recovered), true)
    for (const object of ['pending', 'flagged', 'reviewed']) {
      assert.equal(query(store, `worker IS ${object}`).length, 1)
    }
  } finally { store.close() }
})

test('reply persistence failures roll back the reply and preserve later steps without replay', async () => {
  const store = open()
  try {
    declareActions(store, 'action/review HAS action: `?svc => ?svc IS reviewed`')
    declareAutomations(store, 'automation/triage HAS automation: `?svc IS overloaded => "look into ?svc", action/review`')
    store.ingest('api IS overloaded')
    store.db.exec(`CREATE TRIGGER reject_agent_reply BEFORE INSERT ON cave_claim
      WHEN NEW.subject = 'sensor'
      BEGIN SELECT RAISE(ABORT, 'reply persistence interrupted'); END`)
    let calls = 0
    const complete = async () => { calls++; return 'CUSTOM IS verb\nsensor CUSTOM ready' }
    const report = await settle(store, { complete })
    const [prompt, action] = report.automations[0]!.firings[0]!.steps
    assert.equal(prompt!.outcome, 'failed')
    assert.match(prompt!.detail!, /reply persistence interrupted/)
    assert.equal(action!.outcome, 'ok')
    assert.equal(settled(report), false)
    assert.equal(query(store, 'api IS reviewed').length, 1)
    assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), false)
    const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.doesNotMatch(history, /CUSTOM IS verb|sensor CUSTOM ready/)
    store.db.exec('DROP TRIGGER reject_agent_reply')
    assert.equal(firedOf(await settle(store, { complete }), 'automation/triage'), 0)
    assert.equal(calls, 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    store.ingest('worker IS overloaded')
    const recovered = await settle(store, { complete })
    assert.equal(firedOf(recovered, 'automation/triage'), 1)
    assert.equal(settled(recovered), true)
    assert.equal(calls, 2)
    assert.equal(query(store, 'sensor CUSTOM ready').length, 1)
    assert.equal(query(store, 'worker IS reviewed').length, 1)
  } finally { store.close() }
})

test('an agent error is a step failure the cycle survives', async () => {
  const store = open()
  declareAutomations(store, 'automation/triage HAS automation: `?svc IS overloaded => "look into ?svc", hook/log`')
  store.ingest('api IS overloaded')
  const report = await settle(store, {
    complete: async () => { throw new Error('agent exited with 1') },
    hooks: { log: 'true' }
  })
  const [prompt, hook] = report.automations[0]!.firings[0]!.steps
  assert.equal(prompt!.outcome, 'failed')
  assert.equal(hook!.outcome, 'ok', 'later steps still run')
  assert.equal(settled(report), false)
  store.close()
})

test('automations chain across a cycle: one automation’s effect is the next one’s event (spec §29.4)', async () => {
  const store = open()
  declareActions(store, 'action/flag HAS action: `?svc => ?svc IS flagged`')
  declareAutomations(store,
    'automation/first HAS automation: `?svc IS overloaded => action/flag`\n' +
    'automation/second HAS automation: `?svc IS flagged => hook/log`')
  store.ingest('api IS overloaded')

  const report = await settle(store)
  assert.equal(firedOf(report, 'automation/first'), 1)
  assert.equal(firedOf(report, 'automation/second'), 1, 'the chained automation fired in the same cycle')
  assert.ok(report.passes >= 2)
  store.close()
})

test('rules fire in the cycle, and derived claims are events (spec §29.4)', async () => {
  const store = open()
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  declareAutomations(store, 'automation/deps HAS automation: `web NEEDS ?leaf => hook/log`')
  store.ingest('web NEEDS db\ndb NEEDS disk')

  const report = await settle(store)
  assert.ok(report.derive !== undefined && report.derive.appended >= 1, 'the transitive conclusion was derived')
  assert.equal(query(store, 'web NEEDS disk').length, 1)
  const fired = report.automations.find(automation => automation.subject === 'automation/deps')!
  assert.ok(fired.fired >= 1)
  assert.ok(fired.firings.some(firing => firing.bindings['leaf'] === 'disk'), 'the derived row triggered')

  const again = await settle(store)
  assert.equal(firedOf(again, 'automation/deps'), 0, 'derivation is idempotent, so nothing re-fires')
  store.close()
})

test('declaration idempotence follows the newest actor series, including disabled rows', () => {
  for (const state of ['changed', 'retracted', 'negated'] as const) {
    const store = open()
    try {
      const text = 'automation/watch HAS automation: `?x IS hot => hook/log`'
      assert.equal(declareAutomations(store, text).declared, 1)
      const peerText = state === 'changed'
        ? 'automation/watch HAS automation: `?x IS cold => hook/log`'
        : text
      assert.deepEqual(store.ingest(peerText, { source: 'peer' }).problems, [])
      if (state !== 'changed') {
        const row = store.currentBeliefs().findLast(row => row.subject === 'automation/watch')!
        store.insertResult({
          claims: [{ claim: {
            ...store.toClaim(row),
            ...state === 'retracted' ? { conf: 0 } : { negated: true },
            raw: ''
          }, line: 0 }],
          edges: [], registry: store.registry(), problems: []
        })
        assert.deepEqual(listAutomations(store), [], state)
      }
      const restored = declareAutomations(store, text)
      assert.equal(restored.declared, 1, state)
      assert.equal(restored.unchanged, 0, state)
      assert.deepEqual(restored.problems, [])
      assert.equal(declareAutomations(store, text).unchanged, 1, state)
      assert.equal(listAutomations(store).length, 1, state)
    } finally {
      store.close()
    }
  }
})

test('declare / list / retract lifecycle, idempotent like actions (spec §29.1)', async () => {
  const store = open()
  const text = 'automation/watch HAS automation: `?x IS hot => hook/log` ; watch hot things'
  const first = declareAutomations(store, text)
  assert.equal(first.declared, 1)
  const second = declareAutomations(store, text)
  assert.equal(second.declared, 0)
  assert.equal(second.unchanged, 1)

  const listed = listAutomations(store)
  assert.equal(listed.length, 1)
  assert.equal(listed[0]!.name, 'watch')
  assert.equal(listed[0]!.description, 'watch hot things')
  assert.equal(listed[0]!.ok, true)

  const retraction = retractAutomation(store, 'watch')
  assert.ok(retraction.ok)
  assert.equal(listAutomations(store).length, 0)
  store.ingest('api IS hot')
  const report = await settle(store)
  assert.equal(report.automations.length, 0, 'a retracted automation is disabled')
  store.close()
})

test('a stored declaration that does not parse is reported and skipped', async () => {
  const store = open()
  store.ingest('automation/broken HAS automation: `?x IS hot => frob/it`')
  store.ingest('api IS hot')
  const report = await settle(store)
  assert.equal(report.problems.length, 1)
  assert.equal(report.problems[0]!.subject, 'automation/broken')
  assert.equal(settled(report), false)
  store.close()
})

test('an agent can declare an automation through ordinary appends (spec §29.5)', async () => {
  const store = open()
  store.ingest('automation/watch HAS automation: `?x IS hot => hook/log`', { source: 'agent/claude' })
  store.ingest('api IS hot', { source: 'agent/claude' })
  const report = await settle(store)
  assert.equal(firedOf(report, 'automation/watch'), 1, 'declarations are ordinary claims, whoever appends them')
  store.close()
})

test('invalid hook budgets do not consume automation events and corrected budgets can retry', async () => {
  for (const step of ['hook/log', 'action/mark']) {
    const store = open()
    try {
      declareActions(store, 'action/mark HAS action: `?svc => ?svc IS reviewed`\naction/mark HAS hook: log')
      declareRules(store, 'api IS overloaded => api IS needs-review')
      declareAutomations(store, `automation/review HAS automation: \`?svc IS overloaded => ${step}\``)
      store.ingest('api IS overloaded')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const hooks = { log: 'echo completed' }
      for (const limits of [
        ...[-1, NaN, Infinity, 0.0001, 2147483.648].map(hookTimeoutSeconds => ({ hookTimeoutSeconds })),
        ...[-1, 0.5, Infinity].flatMap(value => [{ hookMaxStdoutBytes: value }, { hookMaxStderrBytes: value }])
      ]) {
        await assert.rejects(settle(store, { hooks, ...limits }), /hook/)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before,
          'invalid budgets leave claims, derivations, firing logs and watermarks untouched')
      }
      const retry = await settle(store, { hooks, hookTimeoutSeconds: 1.001 })
      assert.equal(firedOf(retry, 'automation/review'), 1)
      assert.equal(retry.automations[0]!.firings[0]!.steps[0]!.outcome, 'ok')
      assert.equal(settled(retry), true)
      store.ingest('worker IS overloaded')
      const unlimited = await settle(store, { hooks, hookTimeoutSeconds: 0 })
      assert.equal(firedOf(unlimited, 'automation/review'), 1)
      assert.equal(unlimited.automations[0]!.firings[0]!.steps[0]!.outcome, 'ok')
    } finally { store.close() }
  }
})

test('direct automation hooks use only own configuration entries', async () => {
  for (const name of ['constructor', 'toString', 'inherited']) {
    const store = open()
    try {
      declareAutomations(store, `automation/review HAS automation: \`?svc IS overloaded => hook/${name}\``)
      store.ingest('api IS overloaded')
      const hooks = name === 'inherited' ? Object.create({ inherited: 'echo inherited' }) : {}
      const result = await settle(store, { hooks })
      assert.equal(result.automations[0]!.firings[0]!.steps[0]!.outcome, 'not-configured')
      store.ingest('worker IS overloaded')
      const configured = await settle(store, { hooks: { [name]: 'echo configured' } })
      const step = configured.automations[0]!.firings[0]!.steps[0]!
      assert.equal(step.outcome, 'ok')
      assert.equal(step.detail, 'configured')
    } finally { store.close() }
  }
})

test('malformed hook mappings reject settlement without consuming events', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/review HAS automation: `?svc IS overloaded => hook/log`')
    store.ingest('api IS overloaded')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const hooks of [null, [], 'echo bad', { log: 42 }, { unused: false },
      Object.defineProperty({}, 'log', { value: 42 })]) {
      await assert.rejects(settle(store, { hooks: hooks as never }), /hooks/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    const retry = await settle(store, { hooks: { log: 'echo completed' } })
    assert.equal(firedOf(retry, 'automation/review'), 1)
    assert.equal(retry.automations[0]!.firings[0]!.steps[0]!.outcome, 'ok')
  } finally { store.close() }
})

test('a throwing hook getter records a failed step and allows remaining steps to run', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/review HAS automation: `?svc IS overloaded => hook/broken, hook/next`')
    store.ingest('api IS overloaded')
    let reads = 0
    const hooks = { get broken(): string { reads++; throw new Error('private configuration detail') }, next: 'echo completed' }
    const result = await settle(store, { hooks })
    const steps = result.automations[0]!.firings[0]!.steps
    assert.equal(steps[0]!.outcome, 'failed')
    assert.equal(steps[0]!.detail, 'hook configuration lookup failed')
    assert.equal(steps[1]!.outcome, 'ok')
    assert.equal(steps[1]!.detail, 'completed')
    assert.equal(settled(result), false)
    assert.equal(reads, 1)
    assert.equal(firedOf(await settle(store, { hooks }), 'automation/review'), 0)
    assert.equal(reads, 1)
    store.ingest('worker IS overloaded')
    const invalid = await settle(store, { hooks: { get broken() { return 42 as never }, next: 'echo completed' } })
    assert.equal(invalid.automations[0]!.firings[0]!.steps[0]!.detail, 'hook command must be a string')
    assert.equal(invalid.automations[0]!.firings[0]!.steps[1]!.outcome, 'ok')
  } finally { store.close() }
})


test('automation replies retain tiny confidence revisions and deduplicate only equal beliefs', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/confidence HAS automation: `clock HAS tick: ?tick => "assess sensor"`')
    let tick = 0
    let previousId: string | undefined
    for (const [percentage, confidence] of [
      ['0%', 0], ['0.00000001%', 1e-10], ['0.0000000101%', 1.01e-10], ['0%', 0], ['0.00000001%', 1e-10],
    ] as const) {
      const complete = async () => `sensor IS active @ ${percentage}`
      store.ingest(`clock HAS tick: ${++tick}`)
      const result = await settle(store, { complete })
      assert.ok(settled(result))
      assert.equal(firedOf(result, 'automation/confidence'), 1)
      assert.equal(result.automations[0]!.firings[0]!.steps[0]!.appended, 1, percentage)
      const row = store.currentBeliefs().find(row => row.subject === 'sensor')!
      assert.equal(row.conf, confidence)
      assert.notEqual(row.id, previousId)
      previousId = row.id
      assert.ok(store.provenanceOf(row).runs.includes('automation/confidence'))
      store.ingest(`clock HAS tick: ${++tick}`)
      const repeated = await settle(store, { complete })
      assert.ok(settled(repeated))
      assert.equal(firedOf(repeated, 'automation/confidence'), 1)
      assert.equal(repeated.automations[0]!.firings[0]!.steps[0]!.appended, 0)
      assert.equal(store.currentBeliefs().find(row => row.subject === 'sensor')!.id, row.id)
    }
  } finally { store.close() }
})


test('automation reply deduplication follows earlier revisions in the same response', async () => {
  for (const [original, revision] of [
    ['sensor HAS status: ready', 'sensor HAS status: paused'],
    ['sensor IS active', 'sensor IS active @ 0%'],
  ]) {
    const store = open()
    try {
      declareAutomations(store, 'automation/reply-order HAS automation: `clock HAS tick: ?tick => "assess sensor"`')
      let tick = 0
      const run = async (reply: string) => {
        store.ingest(`clock HAS tick: ${++tick}`)
        const result = await settle(store, { complete: async () => reply })
        assert.ok(settled(result))
        assert.equal(firedOf(result, 'automation/reply-order'), 1)
        return result.automations[0]!.firings[0]!.steps[0]!.appended
      }
      assert.equal(await run(original!), 1)
      const before = store.currentBeliefs().find(row => row.subject === 'sensor')!
      assert.equal(await run(`${revision}\n${original}`), 2)
      const restored = store.currentBeliefs().find(row => row.subject === 'sensor')!
      assert.equal(restored.value_text, before.value_text)
      assert.equal(restored.conf, before.conf)
      assert.notEqual(restored.id, before.id)
      assert.equal(await run(`${original}\n${original}`), 0)
      assert.equal(store.currentBeliefs().find(row => row.subject === 'sensor')!.id, restored.id)
      assert.equal(await run(`${revision}\n${revision}`), 1)
    } finally { store.close() }
  }
})


test('reply deduplication holds the write reservation through insertion', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-reply-reservation-'))
  const path = join(dir, 'store.db')
  const store = open(path)
  const peer = open(path)
  try {
    peer.db.exec('PRAGMA busy_timeout = 0')
    const parsed = Automation.parse('automation/review', 'clock EXISTS => "review"')
    assert.ok(parsed.ok)
    const currentBelief = store.currentBelief.bind(store)
    let attempted = false
    let blocked = false
    t.mock.method(store, 'currentBelief', (...args: Parameters<typeof store.currentBelief>) => {
      const current = currentBelief(...args)
      if (!attempted) {
        attempted = true
        try { peer.ingest('sensor IS ready', { source: 'automation/review', lifecycle: true }) }
        catch (error) {
          assert.match(String(error), /locked|busy/i)
          blocked = true
        }
      }
      return current
    })
    assert.equal(appendReply(store, parsed.automation, 'sensor IS ready').appended, 1)
    assert.equal(attempted, true)
    assert.equal(blocked, true, 'a peer cannot commit between deduplication and insertion')
    assert.equal(claimCount(store), 1)
    assert.equal(appendReply(store, parsed.automation, 'sensor IS ready').appended, 0)
    assert.deepEqual(peer.ingest('peer IS usable').problems, [])
  } finally { peer.close(); store.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('reply insertion failures roll back claims and vocabulary and allow retry', t => {
  const store = open()
  try {
    const parsed = Automation.parse('automation/review', 'clock EXISTS => "review"')
    assert.ok(parsed.ok)
    const reply = 'CUSTOM IS verb\nsensor CUSTOM ready'
    const registryBefore = structuredClone(store.registry())
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const insert = store.insertResult.bind(store)
    const injected = t.mock.method(store, 'insertResult', (...args: Parameters<typeof store.insertResult>) => {
      insert(...args)
      throw new Error('reply insertion interrupted')
    })
    assert.throws(() => appendReply(store, parsed.automation, reply), /reply insertion interrupted/)
    assert.deepEqual(store.registry(), registryBefore)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    injected.mock.restore()
    assert.equal(appendReply(store, parsed.automation, reply).appended, 2)
    assert.equal(appendReply(store, parsed.automation, reply).appended, 0)
  } finally { store.close() }
})


test('reply transactions refresh cached vocabulary after peer declarations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-reply-vocabulary-'))
  const path = join(dir, 'store.db')
  const store = open(path)
  const peer = open(path)
  try {
    const parsed = Automation.parse('automation/review', 'clock EXISTS => "review"')
    assert.ok(parsed.ok)
    store.registry()
    assert.deepEqual(peer.ingest('HOSTS IS verb\nHOSTS REVERSE HOSTED-BY').problems, [])
    assert.equal(appendReply(store, parsed.automation, 'service HOSTED-BY host').appended, 1)
    assert.ok(store.currentBeliefs().some(row => row.subject === 'host' && row.verb === 'HOSTS' && row.object === 'service'))
    assert.deepEqual(peer.ingest('HOSTS RENAMED-TO ACCOMMODATES').problems, [])
    assert.equal(appendReply(store, parsed.automation, 'host ACCOMMODATES other').appended, 1)
    assert.ok(store.currentBeliefs().some(row => row.subject === 'host' && row.verb === 'HOSTS' && row.object === 'other'))
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(appendReply(store, parsed.automation, 'host ACCOMMODATES other').appended, 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { peer.close(); store.close(); rmSync(dir, { recursive: true, force: true }) }
})


test('cancelled prompt failures retain diagnostics and do not replay claimed batches', async () => {
  for (const wrapped of [false, true]) {
    const store = open()
    try {
      declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => "review ?x"`')
      store.ingest('api IS hot')
      const controller = new AbortController()
      const reason = new Error('cancel completion')
      const failure = wrapped ? new Error('completion cleanup failed', { cause: reason }) : new Error('completion failed')
      await assert.rejects(settle(store, {
        signal: controller.signal,
        complete: async () => { controller.abort(reason); throw failure }
      }), error => {
        if (wrapped) return error === failure
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [reason, failure])
        return true
      })
      assert.equal(query(store, `automation/watch HAS ${watermarkAttribute}: ?tx`).length, 1)
      assert.equal(firedOf(await settle(store), 'automation/watch'), 0)
    } finally { store.close() }
  }
})


test('hook automation placeholder retains the firing automation name despite a same-named binding', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/page HAS automation: `?automation IS overloaded => hook/page`')
    store.ingest('api IS overloaded')
    const report = await settle(store, { hooks: { page: "printf '%s' {automation}" } })
    const firing = report.automations[0]!.firings[0]!
    assert.equal(firing.bindings['automation'], 'api')
    assert.equal(firing.steps[0]!.outcome, 'ok')
    assert.equal(firing.steps[0]!.detail, 'page')
    assert.equal(firedOf(await settle(store), 'automation/page'), 0)
  } finally { store.close() }
})


test('automation cancellation tolerates cyclic and unreadable error metadata', async () => {
  for (const shape of ['nested', 'cyclic', 'unreadable']) {
    const store = open()
    try {
      declareAutomations(store, 'automation/review HAS automation: `?x IS service => "review ?x"`')
      store.ingest('api IS service')
      const controller = new AbortController()
      const reason = new Error('stop metadata test')
      const failure = shape === 'nested' ? new AggregateError([new Error('cleanup', { cause: reason })], 'wrapped cleanup') : new Error('completion failed')
      if (shape === 'cyclic') Object.defineProperty(failure, 'cause', { value: failure })
      if (shape === 'unreadable') Object.defineProperty(failure, 'cause', { get() { throw new Error('opaque cause') } })
      await assert.rejects(settle(store, {
        signal: controller.signal,
        complete: async () => { controller.abort(reason); throw failure }
      }), error => {
        if (shape === 'nested') return error === failure
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [reason, failure])
        assert.equal(error.cause, reason)
        return true
      })
      assert.equal(firedOf(await settle(store), 'automation/review'), 0)
    } finally { store.close() }
  }
})

test('failed premise serialization does not consume an automation event and repaired retry fires once', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/review HAS automation: `?x IS service => "Review ?x"`')
    store.ingest('api IS service #phase:ready\nworker IS service #phase:ready')
    const row = query(store, 'worker IS service')[0]!.row!
    store.db.prepare("UPDATE cave_tag SET value = ? WHERE claim_id = ? AND key = 'phase'").run(new Uint8Array([1, 2]), row.id)
    const before = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
    let calls = 0
    const complete = async () => { calls++; return '' }
    await assert.rejects(settle(store, { complete, derive: false }))
    assert.equal(calls, 0)
    assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), before)
    store.db.prepare("UPDATE cave_tag SET value = 'ready' WHERE claim_id = ? AND key = 'phase'").run(row.id)
    assert.equal(firedOf(await settle(store, { complete, derive: false }), 'automation/review'), 2)
    assert.equal(calls, 2)
    const after = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(firedOf(await settle(store, { complete, derive: false }), 'automation/review'), 0)
    assert.equal(calls, 2)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), after)
  } finally { store.close() }
})

test('automation premise text stays with its claimed batch across awaited steps', async () => {
  const store = open()
  try {
    declareAutomations(store, 'automation/review HAS automation: `?x IS service => "Review ?x"`')
    store.ingest('api IS service #phase:before\nworker IS service #phase:before')
    const row = query(store, 'worker IS service')[0]!.row!
    const prompts: string[] = []
    const report = await settle(store, { derive: false, complete: async prompt => {
      prompts.push(prompt)
      if (prompts.length === 1) {
        await Promise.resolve()
        store.db.prepare("UPDATE cave_tag SET value = 'after' WHERE claim_id = ? AND key = 'phase'").run(row.id)
      }
      return ''
    } })
    assert.equal(firedOf(report, 'automation/review'), 2)
    assert.equal(prompts.length, 2)
    assert.match(prompts[1]!, /worker IS service #phase:before/)
    assert.doesNotMatch(prompts[1]!, /#phase:after/)
    assert.equal(store.db.prepare("SELECT value FROM cave_tag WHERE claim_id = ? AND key = 'phase'").get(row.id)?.value, 'after')
  } finally { store.close() }
})

test('automation batches reuse shared premise text without caching across later events', async t => {
  const store = open()
  try {
    store.ingest('gate IS open #phase:before')
    declareAutomations(store, 'automation/review HAS automation: `gate IS open, ?x IS service => "Review ?x"`')
    store.ingest(Array.from({ length: 8 }, (_, index) => `service-${index} IS service`).join('\n'))
    const gate = query(store, 'gate IS open')[0]!.row!
    const toClaim = store.toClaim.bind(store)
    let gateReads = 0
    t.mock.method(store, 'toClaim', (row: Parameters<typeof toClaim>[0]) => { if (row.id === gate.id) gateReads++; return toClaim(row) })
    const prompts: string[] = []
    const complete = async (prompt: string) => { prompts.push(prompt); return '' }
    assert.equal(firedOf(await settle(store, { complete, derive: false }), 'automation/review'), 8)
    assert.equal(gateReads, 1)
    assert.equal(prompts.length, 8)
    for (const prompt of prompts) assert.equal(prompt.match(/gate IS open #phase:before/g)?.length, 1)
    store.db.prepare("UPDATE cave_tag SET value = 'after' WHERE claim_id = ? AND key = 'phase'").run(gate.id)
    store.ingest('service-later IS service')
    gateReads = 0
    assert.equal(firedOf(await settle(store, { complete, derive: false }), 'automation/review'), 1)
    assert.equal(gateReads, 1)
    assert.match(prompts.at(-1)!, /gate IS open #phase:after/)
    assert.doesNotMatch(prompts.at(-1)!, /#phase:before/)
    assert.equal(firedOf(await settle(store, { complete, derive: false }), 'automation/review'), 0)
    assert.equal(prompts.length, 9)
  } finally { t.mock.restoreAll(); store.close() }
})

test('cancellation observed during premise preparation leaves the batch unclaimed for retry', async t => {
  const store = open()
  try {
    declareAutomations(store, 'automation/review HAS automation: `?x IS service => "Review ?x"`')
    store.ingest('api IS service')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const controller = new AbortController(), reason = new Error('cancel during preparation')
    const toClaim = store.toClaim.bind(store)
    const projection = t.mock.method(store, 'toClaim', (row: Parameters<typeof toClaim>[0]) => {
      const claim = toClaim(row)
      controller.abort(reason)
      return claim
    })
    let calls = 0
    const complete = async () => { calls++; return '' }
    await assert.rejects(settle(store, { signal: controller.signal, complete, derive: false }), error => error === reason)
    projection.mock.restore()
    assert.equal(calls, 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(firedOf(await settle(store, { complete, derive: false }), 'automation/review'), 1)
    assert.equal(calls, 1)
    assert.equal(firedOf(await settle(store, { complete, derive: false }), 'automation/review'), 0)
    assert.equal(calls, 1)
  } finally { t.mock.restoreAll(); store.close() }
})

test('preparation failures retain concurrent cancellation and permit an unclaimed retry', async t => {
  for (const wrapped of [false, true]) {
    const store = open()
    try {
      declareAutomations(store, 'automation/review HAS automation: `?x IS service => "Review ?x"`')
      store.ingest('api IS service')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const controller = new AbortController(), reason = new Error('cancel preparation')
      const failure = new Error('projection failed', wrapped ? { cause: reason } : undefined)
      const projection = t.mock.method(store, 'toClaim', () => { controller.abort(reason); throw failure })
      let calls = 0
      const complete = async () => { calls++; return '' }
      await assert.rejects(settle(store, { signal: controller.signal, complete, derive: false }), error => {
        if (wrapped) return error === failure
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [reason, failure])
        assert.equal(error.cause, reason)
        assert.match(error.message, /cancel preparation.*projection failed/)
        return true
      })
      projection.mock.restore()
      assert.equal(calls, 0)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.equal(firedOf(await settle(store, { complete, derive: false }), 'automation/review'), 1)
      assert.equal(firedOf(await settle(store, { complete, derive: false }), 'automation/review'), 0)
      assert.equal(calls, 1)
    } finally { t.mock.restoreAll(); store.close() }
  }
})


test('binary automation bodies identify the stored row and recover without consuming events', async () => {
  for (const bytes of [new Uint8Array(), new Uint8Array([61, 62])]) {
    const store = open()
    try {
      declareAutomations(store, 'automation/review HAS automation: `?x IS service => "review ?x"`')
      store.ingest('api IS service')
      const row = store.db.prepare("SELECT id, value_text FROM cave_claim WHERE attribute = 'automation'").get()!
      assert.equal(typeof row.id, 'string')
      assert.equal(typeof row.value_text, 'string')
      store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run(bytes, row.id as string)
      const before = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
      const expected = { name: 'TypeError', message: `stored automation field "automation" value_text must be text (claim ${JSON.stringify(row.id)})` }
      assert.throws(() => loadAutomations(store), expected)
      assert.throws(() => listAutomations(store), expected)
      let calls = 0
      const complete = async () => { calls++; return '' }
      await assert.rejects(settle(store, { derive: false, complete }), expected)
      assert.equal(calls, 0)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), before)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_edge').all(), [])
      store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run(row.value_text as string, row.id as string)
      assert.equal(loadAutomations(store).loaded[0]?.automation.name, 'review')
      assert.equal(listAutomations(store)[0]?.ok, true)
      assert.equal(firedOf(await settle(store, { derive: false, complete }), 'automation/review'), 1)
      assert.equal(firedOf(await settle(store, { derive: false, complete }), 'automation/review'), 0)
      assert.equal(calls, 1)
    } finally { store.close() }
  }
})


test('redeclaring a binary automation body rearms without replaying older events', async () => {
  for (const bytes of [new Uint8Array(), new Uint8Array([61, 62])]) {
    const store = open()
    try {
      const declaration = 'automation/review HAS automation: `?x IS service => "review ?x"`'
      declareAutomations(store, declaration)
      store.ingest('older IS service')
      const row = store.db.prepare("SELECT id FROM cave_claim WHERE attribute = 'automation'").get()!
      store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run(bytes, row.id as string)
      const before = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
      assert.throws(() => retractAutomation(store, 'review'))
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), before)
      const repaired = declareAutomations(store, declaration)
      assert.equal(repaired.declared, 1)
      assert.deepEqual(repaired.problems, [])
      assert.equal(listAutomations(store)[0]?.ok, true)
      assert.equal(declareAutomations(store, declaration).unchanged, 1)
      let calls = 0
      const complete = async () => { calls++; return '' }
      assert.equal(firedOf(await settle(store, { derive: false, complete }), 'automation/review'), 0)
      store.ingest('newer IS service')
      assert.equal(firedOf(await settle(store, { derive: false, complete }), 'automation/review'), 1)
      assert.equal(firedOf(await settle(store, { derive: false, complete }), 'automation/review'), 0)
      assert.equal(calls, 1)
      assert.deepEqual(retractAutomation(store, 'review'), { ok: true, subject: 'automation/review', retracted: 1 })
      assert.equal(listAutomations(store).length, 0)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim WHERE id = ?').get(row.id as string), before.find(entry => entry.id === row.id))
    } finally { store.close() }
  }
})
