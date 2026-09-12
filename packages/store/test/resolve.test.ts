import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open, Resolve } from '@cavelang/store'
import { SourceSpan } from '@cavelang/core'

test('ranked results retain finite precedence beyond the safe integer range', () => {
  const store = open()
  try {
    store.ingest('server IS compromised @ 60% @src:custom\nserver IS NOT compromised @ 90% @src:archive')
    for (const precedence of [1e16, -1e16]) {
      for (const size of [1, 17]) {
        const entries = [{ prefix: 'custom', precedence },
          ...Array.from({ length: size - 1 }, (_, i) => ({ prefix: `unused/${i}`, precedence: 0 }))]
        const rows = store.db.prepare(Resolve.rankedSql(entries, 'SELECT * FROM cave_claim')).all() as unknown as Resolve.Ranked[]
        assert.equal(rows.find(row => row.negated === 0)!.res_class, precedence)
        assert.equal(rows.find(row => row.res_rank === 1)!.negated, precedence > 0 ? 0 : 1)
      }
      store.ingest(`source/custom HAS precedence: ${precedence}`)
      assert.equal(store.resolutionPolicy().find(entry => entry.prefix === 'custom')!.precedence, precedence)
      const group = store.contested().find(group => group.rows.some(row => row.subject === 'server'))!
      assert.equal(group.rows.find(row => row.negated === 0)!.res_class, precedence)
      assert.equal(group.rows[0]!.negated, precedence > 0 ? 0 : 1)
    }
  } finally { store.close() }
})

test('large materialized policies preserve ranking and complete prefixes', () => {
  const store = open()
  try {
    const prefix = "é'archive\0tail"
    store.ingest(`server IS compromised @ 60% @${SourceSpan.context(prefix + '/child')}\nserver IS NOT compromised @ 90% @src:archive`)
    for (const size of [16, 17, 33_000]) {
      const entries: Resolve.Entry[] = Array.from({ length: size - 2 }, (_, i) => ({ prefix: `unused/${i}`, precedence: 1 }))
      entries.unshift({ prefix: '', precedence: 2 })
      entries.push({ prefix, precedence: 7, reliability: 0.5 })
      const rows = store.db.prepare(Resolve.rankedSql(entries, 'SELECT * FROM cave_claim')).all() as unknown as Resolve.Ranked[]
      const winner = rows.find(row => row.res_rank === 1)!
      assert.equal(winner.negated, 0, String(size))
      assert.equal(winner.res_class, 7)
      assert.equal(winner.res_conf, 0.3)
      const other = rows.find(row => row.negated === 1)!
      assert.equal(other.res_class, 2)
      assert.equal(other.res_conf, 0.9)
    }
  } finally { store.close() }
})

test('complete actor stamps participate only when authored sources do not suppress them', () => {
  const actor = 'cli/é\0suffix'
  for (const authored of [false, true]) {
    const store = open()
    try {
      const added = store.ingest(`server IS compromised @ 60%${authored ? ' @src:archive' : ''}`, { source: actor })
      assert.deepEqual(added.problems, [])
      const row = store.currentBeliefs().find(row => row.subject === 'server')!
      assert.deepEqual(store.provenanceOf(row).actors, [actor])
      const contexts = store.db.prepare('SELECT context FROM cave_context WHERE claim_id = ?').all(row.id)
        .map(value => value.context)
      assert.equal(contexts.includes(`src:${actor}`), !authored)
      store.ingest('server IS NOT compromised @ 90%', { source: 'agent' })
      const ranked = store.contested()[0]!.rows
      assert.equal(ranked.find(candidate => candidate.negated === 0)!.res_class, authored ? 2 : 4)
      assert.equal(store.resolvedBeliefs().find(candidate => candidate.subject === 'server')!.negated, authored ? 1 : 0)
    } finally { store.close() }
  }
})

test('alias resolution preserves complete NUL-bearing subjects and objects', () => {
  for (const position of ['subject', 'object'] as const) {
    const store = open()
    try {
      const first = 'é\0first', second = 'é\0second'
      const fact = (name: string, confidence: number) => position === 'subject'
        ? `${name} USES target @ ${confidence}%`
        : `owner USES ${name} @ ${confidence}%`
      assert.deepEqual(store.ingest(`${fact(first, 60)}\n${fact(second, 70)}`).problems, [])
      const selected = () => store.resolvedBeliefs({ aliases: true }).filter(row => row.verb === 'USES')
      assert.equal(selected().length, 2, `${position}: unrelated names must not collapse`)
      store.ingest(`${first} ALIAS nickname\n${fact('nickname', 90)}`)
      assert.equal(store.resolvedBeliefs().filter(row => row.verb === 'USES').length, 3)
      const resolved = selected()
      assert.equal(resolved.length, 2, `${position}: only actual aliases collapse`)
      assert.deepEqual(resolved.map(row => position === 'subject' ? row.subject : row.object).sort(), ['nickname', second].sort())
      const contested = store.contested({ aliases: true }).filter(group => group.rows.some(row => row.verb === 'USES'))
      assert.equal(contested.length, 1)
      assert.equal(contested[0]!.rows.length, 2)
    } finally { store.close() }
  }
})

test('policy declarations preserve complete source prefixes containing NUL', () => {
  const store = open()
  try {
    const first = 'archive\0first', second = 'archive\0second'
    assert.deepEqual(store.ingest(`source/${first} HAS precedence: 9\nsource/${first} HAS reliability: 0.2\nsource/${second} HAS precedence: 6`).problems, [])
    const policy = store.resolutionPolicy()
    assert.equal(policy.find(entry => entry.prefix === first)?.precedence, 9)
    assert.equal(policy.find(entry => entry.prefix === first)?.reliability, 0.2)
    assert.equal(policy.find(entry => entry.prefix === second)?.precedence, 6)
    assert.equal(policy.find(entry => entry.prefix === 'archive'), undefined)
    store.ingest(`server IS compromised @ 80% @${SourceSpan.context(first + '/deep')}\nserver IS NOT compromised @ 90% @${SourceSpan.context(second)}`)
    const winner = store.resolvedBeliefs().find(row => row.subject === 'server')!
    assert.equal(winner.negated, 0)
    const ranked = store.contested().find(group => group.rows.some(row => row.subject === 'server'))!
    assert.equal(ranked.rows[0]!.res_class, 9)
    assert.ok(Math.abs(ranked.rows[0]!.res_conf - 0.16) < 1e-15)
  } finally { store.close() }
})

test('explicit policy SQL preserves NUL prefixes and whole-segment specificity', () => {
  const store = open()
  try {
    const prefix = "é'archive\0tail"
    store.ingest(`exact IS service @${SourceSpan.context(prefix)}\nchild IS service @${SourceSpan.context(prefix + '/nested')}\nsibling IS service @${SourceSpan.context(prefix + 'suffix')}`)
    const policy = [{ prefix: '', precedence: 2 }, { prefix, precedence: 7 }, { prefix: `${prefix}/nested`, precedence: 9 }]
    const rows = store.db.prepare(Resolve.rankedSql(policy, 'SELECT * FROM cave_claim')).all() as unknown as Resolve.Ranked[]
    assert.deepEqual(Object.fromEntries(rows.map(row => [row.subject, row.res_class])), { exact: 7, child: 9, sibling: 2 })
  } finally { store.close() }
})

test('NUL-bearing declaration sources cannot impersonate a builtin source tier', () => {
  const store = open()
  try {
    store.ingest('source/archive HAS precedence: 9 @ 90% @src:cli\0suffix')
    store.ingest('source/archive HAS precedence: 3 @ 10% @src:agent')
    assert.equal(store.resolutionPolicy().find(entry => entry.prefix === 'archive')?.precedence, 3)
  } finally { store.close() }
})

test('policy declarations retain maximum precedence across large source lists', () => {
  const store = open()
  const sources = Array.from({ length: 130_000 }, (_, i) => `@src:rule/import-${i}`)
  sources.push('@src:cli')
  try {
    store.ingest(`source/ingest HAS precedence: 2 @ 10% ${sources.join(' ')}`)
    store.ingest('source/ingest HAS precedence: 9 @src:agent')
    const before = store.db.prepare('SELECT COUNT(*) AS n FROM cave_context').get()
    const policy = store.resolutionPolicy()
    assert.equal(policy.find(entry => entry.prefix === 'ingest')?.precedence, 2)
    assert.deepEqual(store.resolutionPolicy(), policy)
    assert.deepEqual(store.db.prepare('SELECT COUNT(*) AS n FROM cave_context').get(), before)
  } finally { store.close() }
})

test('empty explicit policies rank by confidence and recency with neutral source weights', () => {
  const store = open()
  try {
    store.ingest('server IS compromised @ 80% @src:scanner\nserver IS NOT compromised @ 60% @src:cli')
    const current = 'SELECT * FROM cave_claim'
    const ranked = store.db.prepare(Resolve.rankedSql([], current)).all() as unknown as Resolve.Ranked[]
    assert.equal(ranked.length, 2)
    assert.ok(ranked.every(row => row.res_class === 0 && row.res_conf === row.conf))
    const winner = store.db.prepare(Resolve.resolvedSql([], current)).all()
    assert.equal(winner.length, 1)
    assert.equal(winner[0]!.negated, 0)
    assert.equal(winner[0]!.conf, 0.8)
    store.ingest('server IS NOT compromised @ 80% @src:review')
    const tied = store.db.prepare(Resolve.resolvedSql([], current)).all()
    assert.equal(tied.length, 1)
    assert.equal(tied[0]!.negated, 1, 'recency breaks equal-confidence ties')
  } finally {
    store.close()
  }
})

test('partial policies apply neutral precedence to each unmatched source before aggregation', () => {
  const store = open()
  try {
    store.ingest('server IS compromised @ 80% @src:rule/derived @src:archive\nserver IS NOT compromised @ 60% @src:review')
    const entries = [{ prefix: 'rule', precedence: -1 }]
    const current = 'SELECT * FROM cave_claim'
    const ranked = store.db.prepare(Resolve.rankedSql(entries, current)).all() as unknown as Resolve.Ranked[]
    const positive = ranked.find(row => row.negated === 0)!
    assert.equal(positive.res_class, 0, 'the unmatched archive outranks the negative rule class')
    assert.equal(positive.res_rank, 1)
    const winner = store.db.prepare(Resolve.resolvedSql(entries, current)).all()
    assert.equal(winner[0]!.negated, 0)
  } finally {
    store.close()
  }
})

test('human correction outranks a machine ingest re-run (spec §26.2)', () => {
  const store = open()
  store.ingest('service HAS owner: alice', { source: 'ingest/93a0' })
  store.ingest('service HAS owner: bob', { source: 'cli' })
  // The re-run appends the newest row — latest-tx alone would flip back.
  store.ingest('service HAS owner: alice', { source: 'ingest/93a0' })
  const owners = store.resolvedBeliefs().filter(row => row.attribute === 'owner')
  assert.equal(owners.length, 1, 'one winner per fact')
  assert.equal(owners[0]!.value_text, 'bob', 'the human-tier series wins regardless of recency')
  store.close()
})

test('recency still governs within a tier — and within one series (spec §26.2)', () => {
  const store = open()
  store.ingest('service HAS owner: alice', { source: 'ingest/a' })
  store.ingest('service HAS owner: carol', { source: 'ingest/b' })
  const owners = store.resolvedBeliefs().filter(row => row.attribute === 'owner')
  assert.equal(owners[0]!.value_text, 'carol', 'same class, same confidence → latest tx')
  store.close()
})

test('polarity is the contest: §9.4 example resolves to the stronger denial', () => {
  const store = open()
  store.ingest('server IS compromised @ 60% @src:scanner-a\nserver IS NOT compromised @ 90% @src:forensics')
  const beliefs = store.resolvedBeliefs().filter(row => row.verb === 'IS')
  assert.equal(beliefs.length, 1)
  assert.equal(beliefs[0]!.negated, 1, 'the negated row wins on confidence')
  assert.equal(beliefs[0]!.conf, 0.9)
  store.close()
})

test('declared reliability discounts a source (spec §26.2, §26.3)', () => {
  const store = open()
  store.ingest([
    'source/scanner-a HAS reliability: 50%',
    'server IS compromised @ 80% @src:scanner-a',    // effective 40%
    'server IS NOT compromised @ 60% @src:forensics' // effective 60%
  ].join('\n'))
  const beliefs = store.resolvedBeliefs().filter(row => row.verb === 'IS' && row.subject === 'server')
  assert.equal(beliefs.length, 1)
  assert.equal(beliefs[0]!.negated, 1, 'weighted confidence flips the winner')
  assert.equal(beliefs[0]!.conf, 0.6, 'the stored row is returned verbatim — conf never rewritten')
  store.close()
})

test('longest declared prefix wins — context specificity (spec §26.3)', () => {
  const store = open()
  store.ingest('source/ingest HAS reliability: 20%\nsource/ingest/93a0 HAS reliability: 90%')
  store.ingest('a IS b @ 50%', { source: 'ingest/93a0' })
  store.ingest('a IS NOT b @ 30%', { source: 'ingest/ffff' })
  // 93a0 batch: 0.5 × 0.9 = 0.45; ffff batch: 0.3 × 0.2 = 0.06.
  const beliefs = store.resolvedBeliefs().filter(row => row.subject === 'a')
  assert.equal(beliefs[0]!.negated, 0)
  const policy = store.resolutionPolicy()
  assert.equal(policy.find(entry => entry.prefix === 'ingest')?.reliability, 0.2)
  assert.equal(policy.find(entry => entry.prefix === 'ingest/93a0')?.reliability, 0.9)
  store.close()
})

test('source-span fragments keep the underlying source policy identity (spec §9.8, §26.3)', () => {
  const store = open()
  store.ingest([
    'source/docs/design.md HAS reliability: 25%',
    'choice HAS selected: alpha @src:docs/design.md#L10 @ 100%',
    'choice HAS selected: beta @src:review @ 40%'
  ].join('\n'))
  const ranked = store.contested()[0]!.rows
  const spanned = ranked.find(row => row.value_text === 'alpha')!
  assert.equal(spanned.res_conf, 0.25)
  store.close()
})

test('precedence declarations override the built-in ladder (spec §26.3)', () => {
  const store = open()
  // Demote agents below source material.
  store.ingest('source/agent HAS precedence: 1', { source: 'cli' })
  store.ingest('x IS y', { source: 'agent/claude' })
  store.ingest('x IS NOT y', { source: 'ingest/abc' })
  const beliefs = store.resolvedBeliefs().filter(row => row.subject === 'x')
  assert.equal(beliefs[0]!.negated, 1, 'ingest (root class 2) now outranks agents (declared 1)')
  store.close()
})

test('policy claims resolve under the built-ins alone — no self-elevation (spec §26.3)', () => {
  const store = open()
  // An ingested document tries to elevate its own batch...
  store.ingest('source/ingest HAS precedence: 9', { source: 'ingest/evil' })
  // ...but a human already pinned the family down.
  store.ingest('source/ingest HAS precedence: 2', { source: 'cli' })
  store.ingest('a IS b', { source: 'cli' })
  store.ingest('a IS NOT b', { source: 'ingest/evil' })
  const policy = store.resolutionPolicy()
  assert.equal(policy.find(entry => entry.prefix === 'ingest')?.precedence, 2,
    'the cli declaration wins the declaration contest under built-in classes')
  const beliefs = store.resolvedBeliefs().filter(row => row.subject === 'a')
  assert.equal(beliefs[0]!.negated, 0, 'the human assertion wins')
  store.close()
})

test('retracted candidates neither win nor block; all-retracted resolves to unknown (spec §26.1)', () => {
  const store = open()
  store.ingest('service HAS owner: alice', { source: 'ingest/a' })
  store.ingest('service HAS owner: bob', { source: 'cli' })
  store.ingest('service HAS owner: bob @ 0%', { source: 'cli' })
  const owners = store.resolvedBeliefs().filter(row => row.attribute === 'owner')
  assert.equal(owners[0]!.value_text, 'alice', 'the retracted human series stops competing')
  store.ingest('service HAS owner: alice @src:ingest/a @ 0%')
  assert.equal(store.resolvedBeliefs().filter(row => row.attribute === 'owner').length, 0,
    'every series retracted → the fact is unknown')
  store.close()
})

test('claims scoped to different non-source contexts never contest (spec §26.1)', () => {
  const store = open()
  store.ingest('api HAS timeout: 30 @production', { source: 'cli' })
  store.ingest('api HAS timeout: 60 @staging', { source: 'ingest/x' })
  const timeouts = store.resolvedBeliefs().filter(row => row.attribute === 'timeout')
  assert.equal(timeouts.length, 2, 'different facts, both survive')
  store.close()
})

test('relations with different objects are different facts; polarity on one object contests (spec §26.1)', () => {
  const store = open()
  store.ingest('auth USES jwt', { source: 'ingest/a' })
  store.ingest('auth USES oauth', { source: 'cli' })
  store.ingest('auth USES NOT jwt @ 90%', { source: 'cli' })
  const uses = store.resolvedBeliefs().filter(row => row.verb === 'USES')
  assert.deepEqual(uses.map(row => [row.object, row.negated]).sort(), [['jwt', 1], ['oauth', 0]])
  store.close()
})

test('rows with several sources: class is the strongest backer, reliability the weakest link (spec §26.2)', () => {
  const store = open()
  store.ingest('source/maria HAS reliability: 90%\nsource/transcript HAS reliability: 40%')
  store.ingest('jan HAS birth-year: 1932 @src:maria @src:transcript @ 100%')
  store.ingest('jan HAS birth-year: 1931 @src:archive @ 50%')
  // min(0.9, 0.4) × 1.0 = 0.4 < 0.5 → the archive wins.
  const years = store.resolvedBeliefs().filter(row => row.attribute === 'birth-year')
  assert.equal(years.length, 1)
  assert.equal(years[0]!.value_text, '1931')
  store.close()
})

test('unsourced rows take the root class (spec §26.2)', () => {
  const store = open()
  store.ingest('x IS y')                            // no stamp — import path
  store.ingest('x IS NOT y', { source: 'rule/abc' }) // derived, class 1
  const beliefs = store.resolvedBeliefs().filter(row => row.subject === 'x')
  assert.equal(beliefs[0]!.negated, 0, 'root class 2 outranks the derived tier')
  store.close()
})

test('resolution groups widen through the alias closure when opted in (spec §26.1)', () => {
  const store = open()
  store.ingest('postgres ALIAS postgresql')
  store.ingest('postgres HAS version: 14', { source: 'ingest/a' })
  store.ingest('postgresql HAS version: 15', { source: 'cli' })
  const plain = store.resolvedBeliefs().filter(row => row.attribute === 'version')
  assert.equal(plain.length, 2, 'without aliases the names keep separate groups')
  const resolved = store.resolvedBeliefs({ aliases: true }).filter(row => row.attribute === 'version')
  assert.equal(resolved.length, 1, 'the closure merges the groups')
  assert.equal(resolved[0]!.value_text, '15')
  assert.equal(resolved[0]!.subject, 'postgresql', 'the winner keeps its stored spelling')
  store.close()
})

test('contested() lists groups with more than one candidate, winner first (spec §26.4)', () => {
  const store = open()
  store.ingest('service HAS owner: alice', { source: 'ingest/93a0' })
  store.ingest('service HAS owner: bob', { source: 'cli' })
  store.ingest('lonely IS fact', { source: 'cli' })
  const contested = store.contested()
  assert.equal(contested.length, 1, 'uncontested facts are not listed')
  const [group] = contested
  assert.equal(group!.rows.length, 2)
  assert.equal(group!.rows[0]!.value_text, 'bob')
  assert.equal(group!.rows[0]!.res_rank, 1)
  assert.equal(group!.rows[0]!.res_class, 4)
  assert.equal(group!.rows[1]!.value_text, 'alice')
  assert.equal(group!.rows[1]!.res_class, 2)
  store.close()
})

test('contested() scores reliability-weighted confidence without rewriting rows (spec §26.4)', () => {
  const store = open()
  store.ingest('source/scanner-a HAS reliability: 50%')
  store.ingest('server IS compromised @ 80% @src:scanner-a\nserver IS NOT compromised @ 60% @src:forensics')
  const group = store.contested().find(candidate =>
    candidate.rows.some(row => row.subject === 'server'))
  assert.ok(group)
  assert.equal(group.rows[0]!.negated, 1)
  assert.equal(group.rows[0]!.res_conf, 0.6)
  assert.equal(group.rows[1]!.res_conf, 0.8 * 0.5)
  assert.equal(group.rows[1]!.conf, 0.8, 'stored confidence untouched')
  store.close()
})

test('traversal resolves winners when opted in (spec §26.4)', () => {
  const store = open()
  store.ingest('auth USES jwt @ 60%', { source: 'ingest/a' })
  store.ingest('auth USES NOT jwt @ 90%', { source: 'cli' })
  const plain = store.forward('auth').filter(fact => fact.verb === 'USES')
  assert.equal(plain.length, 1, 'default read: the positive row is a current belief')
  const resolved = store.forward('auth', { resolve: true }).filter(fact => fact.verb === 'USES')
  assert.equal(resolved.length, 0, 'resolved read: the denial wins, the positive row is invisible')
  const reverse = store.reverse('jwt', { resolve: true }).filter(fact => fact.verb === 'USES')
  assert.equal(reverse.length, 0, 'inverse reads resolve identically')
  store.close()
})

test('traversal with resolve + aliases composes (spec §26.4)', () => {
  const store = open()
  store.ingest('postgres ALIAS postgresql')
  store.ingest('billing USES postgres @ 60%', { source: 'ingest/a' })
  store.ingest('billing USES NOT postgresql @ 90%', { source: 'cli' })
  const plain = store.forward('billing', { aliases: true }).filter(fact => fact.verb === 'USES')
  assert.equal(plain.length, 1)
  const resolved = store.forward('billing', { aliases: true, resolve: true }).filter(fact => fact.verb === 'USES')
  assert.equal(resolved.length, 0, 'the denial about the aliased name wins the widened group')
  store.close()
})

test('unparseable policy declarations are ignored (spec §26.3)', () => {
  const store = open()
  store.ingest('source/ingest HAS precedence: high', { source: 'cli' })    // not a number
  store.ingest('source/ingest HAS reliability: 250%', { source: 'cli' })   // out of range
  const policy = store.resolutionPolicy()
  assert.equal(policy.find(entry => entry.prefix === 'ingest'), undefined)
  assert.deepEqual(policy, Resolve.builtins.map(entry => ({ ...entry })).sort((a, b) =>
    a.prefix < b.prefix ? -1 : 1), 'built-ins alone')
  store.close()
})

test('retracting a policy declaration falls back to the built-in (spec §26.3)', () => {
  const store = open()
  store.ingest('source/agent HAS precedence: 1', { source: 'cli' })
  assert.equal(store.resolutionPolicy().find(entry => entry.prefix === 'agent')?.precedence, 1)
  store.ingest('source/agent HAS precedence: 1 @ 0%', { source: 'cli' })
  assert.equal(store.resolutionPolicy().find(entry => entry.prefix === 'agent')?.precedence, 3,
    'the built-in ladder is back')
  store.close()
})

test('resolvedBeliefs equals currentBeliefs when nothing is contested', () => {
  const store = open()
  store.ingest('auth USES jwt @ 90%\nmonorepo CONTAINS packages/api\napi HAS timeout: 30', { source: 'cli' })
  assert.deepEqual(
    store.resolvedBeliefs().map(row => row.id),
    store.currentBeliefs().map(row => row.id)
  )
  store.close()
})
