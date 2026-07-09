import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Rule } from '@cavelang/rules'

const parsed = (line: string) => {
  const result = Rule.parse(line)
  assert.ok(result.ok, `expected ${JSON.stringify(line)} to parse: ${result.ok ? '' : result.problems.join('; ')}`)
  return result.rule
}

const failed = (line: string) => {
  const result = Rule.parse(line)
  assert.ok(!result.ok, `expected ${JSON.stringify(line)} to fail`)
  return result.problems
}

test('parses the spec §17.4 rules', () => {
  const transitive = parsed('?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  assert.equal(transitive.premises.length, 2)
  assert.equal(transitive.premises.every(premise => premise.kind === 'pattern'), true)
  assert.equal(transitive.conclusion.verb, 'NEEDS')
  assert.equal(transitive.conf, 1)

  const guardian = parsed('?x HAS age: ?a, ?a < 18 => ?x NEEDS guardian')
  assert.equal(guardian.premises[0]!.kind, 'pattern')
  assert.deepEqual(
    guardian.premises[1],
    { kind: 'constraint', variable: 'a', op: '<', value: { raw: '18', kind: 'number', approx: false, num: 18 }, text: '?a < 18' }
  )

  const oncall = parsed('?svc HAS errors: ?e, ?e > 100, ?svc HAS no-owner => ?svc NEEDS oncall-review !')
  assert.equal(oncall.premises.length, 3)
  assert.equal(oncall.conclusion.meta.importance, true)

  const causes = parsed('?x PRECEDES ?event, ?x CONTAINS ?change => ?change CAUSE ?event @ 50%')
  assert.equal(causes.conf, 0.5)
})

test('rule identity: whitespace variants share a digest, comments do not fork it', () => {
  const a = parsed('?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  const b = parsed('?x NEEDS ?y,?y NEEDS ?z=>?x NEEDS ?z ; transitive')
  assert.equal(a.text, b.text)
  assert.equal(a.digest, b.digest)
  assert.equal(b.label, 'transitive')
  assert.equal(a.label, undefined)
})

test('`=>` and commas inside literals never split the rule', () => {
  const rule = parsed('?x HAS note: `a, b => c` => ?x IS annotated')
  assert.equal(rule.premises.length, 1)
  assert.equal(rule.conclusion.payload.kind, 'relation')
  assert.equal(Rule.isRuleLine('x HAS note: `a => b`'), false)
  assert.equal(Rule.isRuleLine('?x NEEDS ?y => ?x IS load-bearing'), true)
})

test('premises are CAVE-Q patterns: NOT, inverses, transitive hops, tags parse', () => {
  const rule = parsed('?x IS NOT deprecated, ?x PART-OF ?repo, ?x EXTENDS+ service #critical => ?x NEEDS review')
  assert.equal(rule.premises.length, 3)
  const transitive = rule.premises[2]!
  assert.ok(transitive.kind === 'pattern' && transitive.pattern.verb.kind === 'verb' && transitive.pattern.verb.transitive)
})

test('rejects malformed rules with actionable problems', () => {
  assert.match(failed('?x NEEDS ?y')[0]!, /no top-level "=>"/)
  assert.match(failed('?x NEEDS ?y => ?x IS a => ?x IS b')[0]!, /exactly one "=>"/)
  assert.match(failed('?x NEEDS ?y => ?x NEEDS ?z').join(' '), /\?z is not bound/)
  assert.match(failed('?a < 18, ?x HAS age: ?a => ?x NEEDS guardian').join(' '), /before any pattern premise binds it/)
  assert.match(failed('?a < 18 => ?a NEEDS guardian').join(' '), /at least one pattern premise/)
  assert.match(failed('?x NEEDS ?y => _ NEEDS review').join(' '), /"_" is not allowed/)
  assert.match(failed('?x NEEDS ?y => nonsense')[0]!, /cannot parse conclusion/)
  assert.match(failed('?x NEEDS ?y, => ?x IS load-bearing').join(' '), /empty premise/)
})

test('constraint values parse numbers with units', () => {
  const rule = parsed('?svc HAS load: ?l, ?l > 1000 req/s => ?svc NEEDS scaling')
  const constraint = rule.premises[1]!
  assert.ok(constraint.kind === 'constraint')
  assert.equal(constraint.value.num, 1000)
  assert.equal(constraint.value.unit, 'req/s')
})

test('conclusion metadata rides along: contexts, tags, comment', () => {
  const rule = parsed('?x USES ?y => ?x NEEDS ?y @production #inferred @ 80% ; usage implies need')
  assert.deepEqual(rule.conclusion.meta.contexts, ['production'])
  assert.deepEqual(rule.conclusion.meta.tags, [{ key: 'inferred' }])
  assert.equal(rule.conf, 0.8)
  assert.equal(rule.label, 'usage implies need')
})
