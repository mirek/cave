import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'
import { declareRules } from '@cavelang/rules'
import { declareActions } from '@cavelang/act'
import {
  declareAutomations, listAutomations, retractAutomation, settle, settled, watermarkAttribute
} from '@cavelang/automate'
import type { SettleReport } from '@cavelang/automate'

const claimCount = (store: ReturnType<typeof open>): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n

const firedOf = (report: SettleReport, subject: string): number =>
  report.automations.find(automation => automation.subject === subject)?.fired ?? 0

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
  const store = open()
  declareActions(store, 'action/flag HAS action: `?svc, ?level => ?svc HAS alert-level: ?level`')
  declareAutomations(store, 'automation/auto-flag HAS automation: `?svc IS overloaded => action/flag`')
  store.ingest('api IS overloaded')

  const report = await settle(store)
  const step = report.automations[0]!.firings[0]!.steps[0]!
  assert.equal(step.outcome, 'failed')
  assert.match(step.detail!, /did not bind \?level/)
  assert.equal(settled(report), false)
  store.close()
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

test('a prompt step without an agent is reported, never fatal (spec §29.3)', async () => {
  const store = open()
  declareAutomations(store, 'automation/triage HAS automation: `?svc IS overloaded => "look into ?svc"`')
  store.ingest('api IS overloaded')
  const report = await settle(store)
  assert.equal(report.automations[0]!.firings[0]!.steps[0]!.outcome, 'not-configured')
  assert.ok(settled(report), 'not-configured is a side-effect-free mode, not a failure')
  store.close()
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
