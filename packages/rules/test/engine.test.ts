import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'
import { Registry } from '@cavelang/canonical'
import { declareRules, derive, listRules, retractRule, ruleSubject } from '@cavelang/rules'

const claimCount = (store: ReturnType<typeof open>): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n

test('forward chaining derives the transitive closure with lineage (spec §24.2–§24.3)', () => {
  const store = open()
  store.ingest('a NEEDS b @ 80%\nb NEEDS c @ 90%\nc NEEDS d')
  const declaration = declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z ; transitive needs')
  assert.equal(declaration.declared, 1)
  assert.deepEqual(declaration.problems, [])
  const digest = declaration.rules[0]!.digest

  const report = derive(store)
  assert.equal(report.appended, 3, 'a→c, b→d, a→d')
  assert.equal(report.retracted, 0)
  assert.deepEqual(report.problems, [])

  // Noisy-AND confidence (spec §10.2 via @cavelang/fusion): 0.8 × 0.9 = 0.72.
  const derived = query(store, '?x NEEDS ?y @src:rule/' + digest)
  const byPair = new Map(derived.map(match => [`${match.bindings['x']}->${match.bindings['y']}`, match.row!]))
  assert.equal(byPair.get('a->c')!.conf, 0.72)
  assert.equal(byPair.get('b->d')!.conf, 0.9)
  // a→d: max over derivation paths — 0.8 × 0.9 either way.
  assert.equal(byPair.get('a->d')!.conf, 0.72)

  // Lineage (spec §24.3): BECAUSE at the specific premise rows, VIA at the rule.
  const edges = store.edgesOf(byPair.get('a->c')!.id)
  const because = edges.filter(edge => edge.role === 'BECAUSE').map(edge => edge.child.raw_line).sort()
  assert.deepEqual(because, ['a NEEDS b @ 80%', 'b NEEDS c @ 90%'])
  const via = edges.filter(edge => edge.role === 'VIA')
  assert.equal(via.length, 1)
  assert.equal(via[0]!.child.subject, ruleSubject(digest))
  store.close()
})

test('re-runs are idempotent and watermark-incremental (spec §24.4)', () => {
  const store = open()
  store.ingest('a NEEDS b\nb NEEDS c')
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  derive(store)
  const rows = claimCount(store)

  const again = derive(store)
  assert.equal(again.appended + again.updated + again.retracted, 0)
  assert.equal(again.rules[0]!.fired, false, 'watermark: nothing new, rule skipped')
  assert.equal(claimCount(store), rows, 'an idle run appends nothing — not even bookkeeping')

  // An unrelated append does not re-fire the rule…
  store.ingest('sky HAS color: blue')
  assert.equal(derive(store).rules[0]!.fired, false)
  // …but a premise-shaped one does.
  store.ingest('c NEEDS e')
  const refired = derive(store)
  assert.equal(refired.rules[0]!.fired, true)
  assert.ok(refired.appended >= 1)
  assert.equal(query(store, 'a NEEDS e').length, 1)
  store.close()
})

test('pass truncation preserves valid suspended conclusions and resumes safely', () => {
  const store = open()
  store.ingest('a NEEDS b\nb NEEDS c\nc NEEDS d\nd NEEDS e\ne NEEDS f')
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  const initial = derive(store)
  assert.equal(initial.complete, true)
  const deepest = query(store, 'a NEEDS f')[0]!.row!
  const historyBefore = store.history(deepest.claim_key).length

  const full = derive(store, { full: true, maxPasses: 1 })
  assert.equal(full.complete, false)
  assert.equal(full.retracted, 0)
  assert.match(full.notes.join('\n'), /no unsupported conclusions were retracted/)
  assert.equal(query(store, 'a NEEDS f').length, 1, 'full truncation keeps a still-valid deep conclusion')
  assert.equal(store.history(deepest.claim_key).length, historyBefore, 'no transient @ 0% row was appended')

  store.ingest('f NEEDS g')
  const incremental = derive(store, { maxPasses: 1 })
  assert.equal(incremental.complete, false)
  assert.equal(incremental.retracted, 0)
  assert.equal(query(store, 'a NEEDS f').length, 1, 'incremental truncation also preserves prior support')

  const resumed = derive(store)
  assert.equal(resumed.complete, true)
  assert.equal(query(store, 'a NEEDS g').length, 1, 'an incomplete run did not advance its watermark')
  store.close()
})

test('retracting a rule preserves RENAMED-TO vocabulary it derived (spec §5.8, §24.5)', () => {
  const store = open()
  store.ingest('schema HAS replacement: EMPLOYED-BY')
  const declaration = declareRules(store, 'schema HAS replacement: ?new => WORKS-AT RENAMED-TO ?new')
  derive(store)
  assert.equal(Registry.preferredOf(store.registry(), 'WORKS-AT'), 'EMPLOYED-BY')
  assert.ok(retractRule(store, declaration.rules[0]!.digest).ok)
  const lifecycle = store.currentBeliefs().find(row => row.verb === 'RENAMED-TO')
  assert.equal(lifecycle?.conf, 1)
  store.close()
})

test('a re-declared rule does not inherit its stale watermark (BUGS.md stale-rule-watermark, spec §24.4)', () => {
  const store = open()
  store.ingest('alpha IS server')
  const file = '?x IS server => ?x NEEDS monitoring'
  const declaration = declareRules(store, file)
  derive(store)
  assert.equal(query(store, 'alpha NEEDS monitoring').length, 1)

  // Retract the rule — its conclusions go with it (§24.5) — then declare
  // the identical text again: same digest, same watermark claim key, and
  // no premise-shaped row newer than the stored watermark.
  const retraction = retractRule(store, declaration.rules[0]!.digest)
  assert.ok(retraction.ok)
  assert.deepEqual(query(store, 'alpha NEEDS monitoring'), [])
  assert.equal(declareRules(store, file).declared, 1)

  const report = derive(store)
  assert.equal(report.rules[0]!.fired, true, 'the stale watermark must not skip the re-declared rule')
  assert.equal(query(store, 'alpha NEEDS monitoring').length, 1, 'conclusions re-derived from pre-watermark premises')

  const idle = derive(store)
  assert.equal(idle.rules[0]!.fired, false, 'the fresh watermark restores incrementality')
  store.close()
})

test('belief updates: premise confidence change re-derives the conclusion', () => {
  const store = open()
  store.ingest('monorepo CONTAINS api @ 80%')
  // Inverse premise and a rule confidence factor.
  declareRules(store, '?part PART-OF ?whole => ?part LIKE ?whole @ 50%')
  derive(store)
  assert.equal(query(store, 'api LIKE monorepo')[0]!.row!.conf, 0.4)

  store.ingest('monorepo CONTAINS api @ 60%')
  const report = derive(store)
  assert.equal(report.updated, 1)
  const series = query(store, 'api LIKE monorepo')
  assert.equal(series[0]!.row!.conf, 0.3)
  assert.equal(store.history(series[0]!.row!.claim_key).length, 2, 'append-only belief series')
  store.close()
})

test('premise retraction retracts dependents, cycles included (spec §24.5)', () => {
  const store = open()
  store.ingest('a NEEDS b\nb NEEDS a')
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  derive(store)
  assert.ok(query(store, '?x NEEDS ?y').length > 2, 'cycle derived self-needs')

  store.ingest('a NEEDS b @ 0%\nb NEEDS a @ 0%')
  const report = derive(store)
  assert.ok(report.retracted >= 4, 'mutually-supporting derivations do not survive their sources')
  assert.equal(query(store, '?x NEEDS ?y').length, 0)
  store.close()
})

test('retraction cascades across rules', () => {
  const store = open()
  store.ingest('AT-RISK IS verb\na NEEDS b\nb IS flaky')
  declareRules(store, '?x NEEDS ?y, ?y IS flaky => ?x AT-RISK ?y')
  declareRules(store, '?x AT-RISK ?y => ?x NEEDS review')
  derive(store)
  assert.equal(query(store, 'a AT-RISK b').length, 1)
  assert.equal(query(store, 'a NEEDS review').length, 1)

  store.ingest('b IS flaky @ 0%')
  const report = derive(store)
  assert.equal(query(store, 'a AT-RISK b').length, 0)
  assert.equal(query(store, 'a NEEDS review').length, 0, 'second rule’s conclusion falls with the first’s')
  assert.equal(report.retracted, 2)
  store.close()
})

test('constraints filter bindings; conclusions below min-conf are not asserted', () => {
  const store = open()
  store.ingest('tom HAS age: 11\nann HAS age: 40\nsvc HAS load: 1500 req/s')
  declareRules(store, '?x HAS age: ?a, ?a < 18 => ?x NEEDS guardian')
  declareRules(store, '?s HAS load: ?l, ?l > 1000 req/s => ?s NEEDS scaling')
  derive(store)
  assert.deepEqual(query(store, '?x NEEDS guardian').map(match => match.bindings['x']), ['tom'])
  assert.deepEqual(query(store, '?s NEEDS scaling').map(match => match.bindings['s']), ['svc'])

  store.ingest('maybe IS candidate @ 1%')
  declareRules(store, '?x IS candidate => ?x IS selected')
  const report = derive(store)
  assert.equal(query(store, 'maybe IS selected').length, 0, '1% is below the default 5% floor')
  assert.equal(report.appended, 0)
  const forced = derive(store, { minConf: 0.001, full: true })
  assert.ok(forced.appended >= 1)
  assert.equal(query(store, 'maybe IS selected')[0]!.row!.conf, 0.01)
  store.close()
})

test('NOT premises match explicitly negated claims, not absence', () => {
  const store = open()
  store.ingest('server IS NOT compromised @ 90%\nlaptop IS compromised')
  declareRules(store, '?x IS NOT compromised => ?x IS trusted')
  derive(store)
  assert.deepEqual(query(store, '?x IS trusted').map(match => match.bindings['x']), ['server'])
  store.close()
})

test('transitive premises bind endpoints without contributing rows or confidence', () => {
  const store = open()
  store.ingest('terrier EXTENDS dog @ 80%\ndog EXTENDS animal @ 80%\nrex IS terrier')
  declareRules(store, '?x IS ?t, ?t EXTENDS+ animal => ?x IS animal-kind')
  derive(store)
  const derived = query(store, 'rex IS animal-kind')
  assert.equal(derived.length, 1)
  // Only the IS premise carries a row; hops are structural (spec §24.2).
  assert.equal(derived[0]!.row!.conf, 1)
  const because = store.edgesOf(derived[0]!.row!.id).filter(edge => edge.role === 'BECAUSE')
  assert.equal(because.length, 1)
  assert.equal(because[0]!.child.raw_line, 'rex IS terrier')
  store.close()
})

test('inverse conclusions canonicalize to the primary direction — one key, either spelling', () => {
  const store = open()
  store.ingest('a USES b')
  declareRules(store, '?x USES ?y => ?y USED-BY ?x @ 60%')
  derive(store)
  const derived = query(store, '?x USES ?y \n WHERE conf <= 0.6')
  assert.equal(derived.length, 1)
  assert.equal(derived[0]!.row!.subject, 'a', 'stored in primary direction')
  assert.equal(derived[0]!.row!.verb, 'USES')
  store.close()
})

test('attribute and value-binding conclusions', () => {
  const store = open()
  store.ingest('api HAS latency: 30ms')
  declareRules(store, '?s HAS latency: ?l => ?s HAS observed-latency: ?l @ 90%')
  derive(store)
  const derived = query(store, '?s HAS observed-latency: ?l')
  assert.equal(derived.length, 1)
  assert.equal(derived[0]!.bindings['l'], '30ms')
  assert.equal(derived[0]!.row!.value_num, 30)
  assert.equal(derived[0]!.row!.value_unit, 'ms')
  store.close()
})

test('derived claims are actor-stamped and keep their own belief series (spec §9.5)', () => {
  const store = open()
  store.ingest('a NEEDS b\nb NEEDS c\na NEEDS c @ 30% ; hand-written belief about the same fact')
  const { rules } = declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  derive(store)
  const all = query(store, 'a NEEDS ?y').filter(match => match.bindings['y'] === 'c')
  assert.equal(all.length, 2, 'the hand-written and the derived series coexist (§9.4)')
  const confs = all.map(match => match.row!.conf).sort()
  assert.deepEqual(confs, [0.3, 1])
  const stamped = all.find(match => match.row!.conf === 1)!
  assert.ok(stamped.row!.claim_key.includes(`src:rule/${rules[0]!.digest}`))
  store.close()
})

test('declaring is idempotent; prelude declares vocabulary once', () => {
  const store = open()
  const file = 'GRANDPARENT-OF IS verb\n?a PARENT-OF ?b, ?b PARENT-OF ?c => ?a GRANDPARENT-OF ?c'
  const first = declareRules(store, 'PARENT-OF IS verb\n' + file)
  assert.equal(first.declared, 1)
  assert.ok(first.prelude >= 2)
  const second = declareRules(store, 'PARENT-OF IS verb\n' + file)
  assert.equal(second.declared, 0)
  assert.equal(second.unchanged, 1)
  assert.equal(second.prelude, 0, 'unchanged prelude skipped by digest')
  assert.equal(listRules(store).length, 1)

  store.ingest('helena PARENT-OF jan\njan PARENT-OF maria')
  derive(store)
  assert.deepEqual(query(store, '?g GRANDPARENT-OF maria').map(match => match.bindings['g']), ['helena'])
  store.close()
})

test('retractRule retracts the declaration and everything it derived', () => {
  const store = open()
  store.ingest('x NEEDS y')
  const { rules } = declareRules(store, '?a NEEDS ?b => ?b NEEDED-BY ?a @ 90%')
  derive(store)
  assert.equal(query(store, '?a NEEDS ?b').length, 2)

  const outcome = retractRule(store, rules[0]!.digest.slice(0, 6))
  assert.ok(outcome.ok)
  assert.equal(outcome.ok && outcome.derived, 1)
  assert.equal(listRules(store).length, 0)
  assert.equal(query(store, '?a NEEDS ?b').length, 1, 'only the hand-written claim survives')

  assert.equal(retractRule(store, 'nonexistent').ok, false)
  store.close()
})

test('dry-run reports without writing', () => {
  const store = open()
  store.ingest('a NEEDS b\nb NEEDS c')
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  const before = claimCount(store)
  const dry = derive(store, { dryRun: true })
  assert.equal(dry.appended, 1)
  assert.equal(claimCount(store), before, 'nothing persisted')
  const real = derive(store)
  assert.equal(real.appended, 1)
  store.close()
})

test('unparseable stored rules are reported and skipped, others still fire', () => {
  const store = open()
  store.ingest('rule/broken HAS rule: `?x NEEDS => nonsense` @src:cave-derive')
  store.ingest('a NEEDS b\nb NEEDS c')
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  const report = derive(store)
  assert.equal(report.problems.length, 1)
  assert.equal(report.problems[0]!.subject, 'rule/broken')
  assert.equal(report.appended, 1)
  store.close()
})

test('alias closure widens premise matching when opted in (spec §13.6)', () => {
  const store = open()
  store.ingest('postgres ALIAS postgresql\nbilling USES postgres\nanalytics USES postgresql')
  declareRules(store, '?x USES postgres => ?x NEEDS db-review')
  derive(store)
  assert.deepEqual(query(store, '?x NEEDS db-review').map(match => match.bindings['x']), ['billing'])
  derive(store, { aliases: true, full: true })
  assert.deepEqual(
    query(store, '?x NEEDS db-review').map(match => match.bindings['x']).sort(),
    ['analytics', 'billing']
  )
  store.close()
})

test('a conclusion naming its own @src: still carries the rule stamp — retraction propagates (BUGS.md src-stamp-bypass, spec §24.5)', () => {
  const store = open()
  store.ingest('a NEEDS b', { source: 'cli' })
  const declaration = declareRules(store, '?x NEEDS ?y => ?x LIKE ?y @src:mine')
  derive(store)
  assert.equal(query(store, 'a LIKE b').length, 1)
  assert.equal(store.byProvenance('run', `rule/${declaration.rules[0]!.digest}`).length > 0, true)
  // Retract the premise — the derivation must not outlive it.
  store.ingest('a NEEDS b @ 0%', { source: 'cli' })
  const report = derive(store)
  assert.equal(report.retracted, 1)
  assert.deepEqual(query(store, 'a LIKE b'), [])
  store.close()
})

test('--retract finds conclusions that name their own @src: (BUGS.md src-stamp-bypass, spec §24.5)', () => {
  const store = open()
  store.ingest('a NEEDS b')
  const declaration = declareRules(store, '?x NEEDS ?y => ?x LIKE ?y @src:mine')
  derive(store)
  const retraction = retractRule(store, declaration.rules[0]!.digest)
  assert.ok(retraction.ok && retraction.derived === 1, 'the derived claim is found and retracted')
  assert.deepEqual(query(store, 'a LIKE b'), [])
  store.close()
})

test('derived claims round-trip through export/import with lineage', () => {
  const store = open()
  store.ingest('a NEEDS b @ 80%\nb NEEDS c @ 90%')
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  derive(store)
  const text = store.exportText()

  const restored = open()
  restored.ingest(text)
  const derived = query(restored, 'a NEEDS c')
  assert.equal(derived.length, 1)
  assert.equal(derived[0]!.row!.conf, 0.72)
  const roles = restored.edgesOf(derived[0]!.row!.id).map(edge => edge.role).sort()
  assert.deepEqual(roles, ['BECAUSE', 'BECAUSE', 'VIA'])
  restored.close()
  store.close()
})
