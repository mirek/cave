import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Automation } from '@cavelang/automate'

const body = (text: string) =>
  Automation.parse('automation/x', text)

test('parses trigger premises and the three step kinds (spec §29.1)', () => {
  const parsed = body('?svc IS service, ?svc HAS error-rate: ?r, ?r > 0.05 => action/open-incident, hook/page, "investigate ?svc"')
  assert.equal(parsed.ok, true)
  const automation = (parsed as { automation: Automation.t }).automation
  assert.equal(automation.name, 'x')
  assert.equal(automation.subject, 'automation/x')
  assert.equal(automation.premises.length, 3)
  assert.equal(automation.premises[0]!.kind, 'pattern')
  assert.equal(automation.premises[2]!.kind, 'constraint')
  assert.deepEqual(automation.steps.map(step => step.kind), ['action', 'hook', 'prompt'])
  assert.equal((automation.steps[0] as { name: string }).name, 'open-incident')
  assert.equal((automation.steps[1] as { name: string }).name, 'page')
  assert.equal((automation.steps[2] as { template: string }).template, 'investigate ?svc')
})

test('normalized text single-spaces tokens and keeps literal delimiters', () => {
  const parsed = body('?a   LIKES   ?b   =>   hook/log ,  "tell ?a"')
  assert.equal(parsed.ok, true)
  assert.equal((parsed as { automation: Automation.t }).automation.text, '?a LIKES ?b => hook/log, "tell ?a"')
})

test('a bare variable segment is rejected — automations take no parameters (spec §29.1)', () => {
  const parsed = body('?svc, ?svc IS service => hook/page')
  assert.equal(parsed.ok, false)
  assert.match((parsed as { problems: readonly string[] }).problems[0]!, /no caller/)
})

test('the trigger needs at least one pattern premise', () => {
  const parsed = body(' => hook/page')
  assert.equal(parsed.ok, false)
  assert.ok((parsed as { problems: readonly string[] }).problems.some(problem => /pattern premise/.test(problem)))
})

test('at least one step is required, and unknown step shapes are named', () => {
  const none = body('?x IS hot =>')
  assert.equal(none.ok, false)
  const unknown = body('?x IS hot => frob/it')
  assert.equal(unknown.ok, false)
  assert.match((unknown as { problems: readonly string[] }).problems[0]!, /not action\/<name>, hook\/<name> or a prompt literal/)
  const claimish = body('?x IS hot => ?x IS handled')
  assert.equal(claimish.ok, false)
})

test('commas and => inside literals never split (spec §24.1 sharing)', () => {
  const parsed = body('?x HAS note: "a, b => c" => "record ?x, then stop"')
  assert.equal(parsed.ok, true)
  const automation = (parsed as { automation: Automation.t }).automation
  assert.equal(automation.premises.length, 1)
  assert.equal(automation.steps.length, 1)
  assert.equal(automation.steps[0]!.kind, 'prompt')
})

test('exactly one top-level => is demanded', () => {
  assert.equal(body('?x IS hot').ok, false)
  assert.equal(body('?x IS hot => hook/a => hook/b').ok, false)
})

test('subject scoping: automationSubject/automationName round-trip', () => {
  assert.equal(Automation.automationSubject('page'), 'automation/page')
  assert.equal(Automation.automationSubject('automation/page'), 'automation/page')
  assert.equal(Automation.automationName('automation/page'), 'page')
  assert.equal(Automation.automationName('action/page'), undefined)
  assert.equal(Automation.automationName('automation/'), undefined)
})
