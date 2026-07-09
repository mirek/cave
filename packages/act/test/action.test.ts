import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as Action from '../src/action.ts'

const parse = (body: string) =>
  Action.parse('action/mark-deployed', body)

test('parses parameters, premises, constraints and effects (spec §25.1)', () => {
  const parsed = parse(
    '?service, ?version, ?service IS service, ?service HAS owner: ?owner, ?version != latest ' +
    '=> ?service HAS deployed-version: ?version, ?owner YIELDS approval @ 80%')
  assert.equal(parsed.ok, true)
  const action = (parsed as { action: Action.t }).action
  assert.equal(action.name, 'mark-deployed')
  assert.deepEqual(action.params, ['service', 'version'])
  assert.equal(action.premises.length, 3)
  assert.equal(action.premises[0]!.kind, 'pattern')
  assert.equal(action.premises[2]!.kind, 'constraint')
  assert.equal(action.effects.length, 2)
  assert.equal(action.effects[1]!.meta.conf, 0.8)
})

test('normalization is stable — reparsing the text reproduces it', () => {
  const first = parse('?service,   ?service IS service =>   ?service   BECOMES deployed')
  assert.equal(first.ok, true)
  const text = (first as { action: Action.t }).action.text
  const second = parse(text)
  assert.equal(second.ok, true)
  assert.equal((second as { action: Action.t }).action.text, text)
})

test('an empty left side is a parameterless, unconditional template', () => {
  const parsed = parse('=> maintenance-window EXISTS')
  assert.equal(parsed.ok, true)
  const action = (parsed as { action: Action.t }).action
  assert.deepEqual(action.params, [])
  assert.deepEqual(action.premises, [])
  assert.equal(action.effects.length, 1)
})

test('a parameter used only by the hook is legal (spec §25.1)', () => {
  const parsed = parse('?service, ?message => ?service BECOMES deployed')
  assert.equal(parsed.ok, true)
  assert.deepEqual((parsed as { action: Action.t }).action.params, ['service', 'message'])
})

const problemsOf = (body: string): readonly string[] => {
  const parsed = parse(body)
  assert.equal(parsed.ok, false, `expected problems for ${JSON.stringify(body)}`)
  return (parsed as { problems: readonly string[] }).problems
}

test('rejects malformed bodies with reported problems, never throws', () => {
  assert.match(problemsOf('?service IS service')[0]!, /no top-level "=>"/)
  assert.match(problemsOf('?a => b IS c => d IS e')[0]!, /exactly one "=>"/)
  assert.match(problemsOf('?service => ')[0]!, /at least one effect|empty effect/)
  assert.match(problemsOf('?service => ?service HAS v: ?version')[0]!, /\?version is neither a parameter nor bound/)
  assert.match(problemsOf('?service, ?service => ?service EXISTS')[0]!, /declared twice/)
  assert.match(problemsOf('?service => _ USES ?service')[0]!, /"_" is not allowed/)
  assert.match(problemsOf('?action => x EXISTS')[0]!, /reserved/)
  assert.match(problemsOf('?x => a HAS ?x: 1')[0]!, /cannot name attributes/)
  assert.match(problemsOf('?x => a EXISTS @env:?x')[0]!, /effect contexts/)
})

test('literals protect commas and arrows from splitting', () => {
  const parsed = parse('?id => ?id HAS note: "deploy, then verify => done"')
  assert.equal(parsed.ok, true)
  const action = (parsed as { action: Action.t }).action
  assert.equal(action.effects.length, 1)
  assert.equal(action.effects[0]!.payload.kind, 'attribute')
})

test('subject naming — actionSubject and actionName round-trip', () => {
  assert.equal(Action.actionSubject('mark-deployed'), 'action/mark-deployed')
  assert.equal(Action.actionSubject('action/mark-deployed'), 'action/mark-deployed')
  assert.equal(Action.actionName('action/team/promote'), 'team/promote')
  assert.equal(Action.actionName('rule/abc'), undefined)
  assert.equal(Action.actionName('action/'), undefined)
})
